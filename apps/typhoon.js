import { getFfmpegPath } from '../utils/common.js'
import plugin from '../../../lib/plugins/plugin.js'
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import stream from 'stream';

const URL_TEMPLATE = 'https://typhoon.slt.zj.gov.cn/'; // URL 模板
const TIME_MAP = 8; // 最大录制时间（秒）
const FPS = 5; // 设置帧率
const ELEMENT_SELECTOR = '#map > div.leaflet-pane.leaflet-map-pane > div.leaflet-pane.leaflet-overlay-pane > svg > g'; // 要检查更新的元素选择器
const NAVIGATION_TIMEOUT = 60000;
const PAGE_READY_TIMEOUT = 25000;
const BROWSER_OPTIONS = {
    headless: 'new',
    args: ['--disable-gpu', '--disable-setuid-sandbox', '--no-sandbox', '--no-zygote']
};

export class TFLJ extends plugin {
    constructor() {
        super({
            name: '憨憨台风路径',
            dsc: '台风路径',
            event: 'message',
            priority: 6,
            rule: [
                { reg: '^#?台风路径$', fnc: 'typhoon', dsc: '台风路径' }
            ]
        })
    }

    async typhoon(e) {
        try {
            await e.reply('收到指令，正在录制GIF');
            const gifBuffer = await captureGif(URL_TEMPLATE, TIME_MAP, FPS, ELEMENT_SELECTOR);
            if (!gifBuffer) {
                await e.reply('未找到相关数据，请稍后重试。');
                return true;
            }

            await e.reply(segment.image(gifBuffer));
        } catch (error) {
            logger.error('Error capturing GIF:', error);
            await e.reply('GIF 录制失败，请稍后重试。');
        }
        return true;
    }
}

async function captureGif(url, maxDuration, fps, elementSelector) {
    logger.info('启动 Puppeteer 浏览器');
    const browser = await puppeteer.launch(BROWSER_OPTIONS);
    const page = await browser.newPage();

    try {
        page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
        page.setDefaultTimeout(PAGE_READY_TIMEOUT);

        logger.info('设置页面视窗大小');
        await page.setViewport({ width: 1080, height: 800 });

        logger.info(`打开 URL: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });
        await waitForMapReady(page, elementSelector);

        logger.info('删除指定的 HTML 元素');
        await cleanPage(page);

        logger.info('开始截屏');
        const frames = [];
        const totalFrames = fps * maxDuration;
        const frameDelay = Math.round(1000 / fps);
        let lastContent = '';
        let unchangedFrames = 0;
        const maxUnchangedFrames = fps;

        for (let i = 0; i < totalFrames; i++) {
            const screenshot = await page.screenshot({ encoding: 'base64' });
            frames.push(Buffer.from(screenshot, 'base64'));

            await sleep(frameDelay);

            const currentContent = await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                return element ? element.innerHTML : '';
            }, elementSelector);

            if (currentContent) {
                if (currentContent === lastContent) {
                    unchangedFrames++;
                } else {
                    unchangedFrames = 0;
                    lastContent = currentContent;
                }

                if (unchangedFrames >= maxUnchangedFrames) {
                    logger.info(`元素 ${elementSelector} 在 ${maxUnchangedFrames / fps} 秒内未发生变化，停止录制`);
                    break;
                }
            }
        }

        if (frames.length === 0) return false;

        logger.info('将截图转换为 GIF');
        return await convertFramesToGif(frames, fps);
    } finally {
        await browser.close().catch(err => logger.warn('关闭 Puppeteer 浏览器失败:', err));
    }
}

async function waitForMapReady(page, elementSelector) {
    logger.info('等待页面地图加载');
    await page.waitForSelector('#map', { visible: true, timeout: PAGE_READY_TIMEOUT });
    await page.waitForFunction(() => {
        const map = document.querySelector('#map');
        return Boolean(map && map.clientWidth > 0 && map.clientHeight > 0);
    }, { timeout: PAGE_READY_TIMEOUT });

    await page.waitForSelector(elementSelector, { timeout: 15000 }).catch(() => {
        logger.warn(`未在等待时间内找到台风路径图层 ${elementSelector}，继续录制当前地图画面`);
    });

    await sleep(1500);
}

async function cleanPage(page) {
    await page.addStyleTag({
        content: `
            #app > header > div.top-operations,
            #app > div.content > div > div.sidebar.sidebar-web,
            #app > div.content > div > div.map-btns,
            #map > div.leaflet-control-container,
            #app > div.content > div > div.legend-box,
            #app > div.content > div > div.history-web {
                display: none !important;
            }
        `
    }).catch(() => {});

    await page.evaluate(() => {
        document.querySelector('#app > header > div.top-operations')?.remove();
        document.querySelector("#app > div.content > div > div.sidebar.sidebar-web")?.remove();
        document.querySelector("#app > div.content > div > div.map-btns")?.remove();
        document.querySelector("#map > div.leaflet-control-container")?.remove();
        document.querySelector("#app > div.content > div > div.legend-box")?.remove();
        document.querySelector("#app > div.content > div > div.history-web")?.remove();
    });
}

async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function convertFramesToGif(frames, fps) {
    return new Promise((resolve, reject) => {
        const ffmpegPath = getFfmpegPath();
        const ffmpeg = spawn(ffmpegPath, [
            '-f', 'image2pipe',
            '-framerate', `${fps}`,  // 设置输入帧率
            '-i', 'pipe:0',          // 输入文件从标准输入（pipe:0）读取
            '-vf', `fps=${fps},scale=1080:-1:flags=lanczos`,
            '-f', 'gif',             // 输出格式为 GIF
            'pipe:1'                // 输出文件到标准输出（pipe:1）
        ]);

        const outputStream = new stream.PassThrough();
        const buffers = [];

        outputStream.on('data', chunk => buffers.push(chunk));
        outputStream.on('end', () => resolve(Buffer.concat(buffers)));
        outputStream.on('error', reject);

        ffmpeg.stdout.pipe(outputStream);

        frames.forEach(frame => ffmpeg.stdin.write(frame));
        ffmpeg.stdin.end();

        ffmpeg.on('error', reject);
        ffmpeg.on('close', code => {
            if (code !== 0) {
                reject(new Error(`FFmpeg process exited with code ${code}`));
            }
        });
    });
}
