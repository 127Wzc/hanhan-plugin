import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import puppeteer from 'puppeteer'

// 搜索引擎配置
const SEARCH_ENGINES = {
  GOOGLE: {
    url: 'https://www.google.com/search?q=',
    needProxy: true,
    viewport: {
      width: 740,
      height: 300
    },
    timeout: 5000
  },
  BAIDU: {
    url: 'https://www.baidu.com/s?wd=',
    needProxy: false, 
    viewport: {
      width: 740,
      height: 300
    },
    timeout: 5000
  },
  BING: {
    url: 'https://www.bing.com/search?q=',
    needProxy: true,
    viewport: {
      width: 740, 
      height: 300
    },
    timeout: 5000
  }
}

export class SearchEngine extends plugin {
  constructor () {
    super({
      name: '憨憨多搜索引擎',
      dsc: '支持多个搜索引擎搜索',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: '^#(\\w+)(=|＝)(.*)$',
          fnc: 'handleSearch'
        }
      ]
    })

    this.config = {
      proxyUrl: Config.proxyUrl,
      chromeF: Config.chromeF,
      echo: Config.sysecho,
      noie: Config.noie,
      echo1: Config.sysecho0,
      gqjt: Config.sysgqjt
    }
  }

  async handleSearch (e) {
    const [engine, query] = this.parseCommand(e.msg)
    const engineConfig = SEARCH_ENGINES[engine]
    
    if (!engineConfig) {
      return await this.reply('不支持的搜索引擎')
    }

    try {
      await this.reply(this.config.echo)
      logger.info('[用户命令]', e.msg)

      const screenshot = await this.takeScreenshot({
        url: engineConfig.url + encodeURIComponent(query),
        needProxy: engineConfig.needProxy,
        viewport: engineConfig.viewport,
        timeout: engineConfig.timeout
      })

      await this.reply(segment.image(screenshot))
    } catch (error) {
      logger.error(error)
      await this.reply(this.config.echo1)
    }
  }

  async takeScreenshot (options) {
    const { url, needProxy, viewport, timeout } = options
    const browser = await puppeteer.launch({
      headless: this.config.noie,
      executablePath: this.config.chromeF,
      args: this.getBrowserArgs(needProxy)
    })

    try {
      const page = await browser.newPage()
      
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: this.config.gqjt
      })

      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: timeout
      })
      
      // 使用 base64 存储截图,避免文件IO
      const screenshot = await page.screenshot({
        encoding: 'base64',
        fullPage: viewport.fullPage !== false
      })

      return `data:image/png;base64,${screenshot}`
    } finally {
      await browser.close()
    }
  }

  parseCommand (msg) {
    const match = msg.match(/^#(\w+)(=|＝)(.*)$/)
    return [
      match[1].toUpperCase(),
      match[3].trim()
    ]
  }

  getBrowserArgs (needProxy) {
    const args = [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--disable-web-security',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ]
    
    if (needProxy) {
      args.push(`--proxy-server=${this.config.proxyUrl}`)
    }
    
    return args
  }
}