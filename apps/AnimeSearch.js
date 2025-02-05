import plugin from '../../../lib/plugins/plugin.js'
import common from '../../../lib/common/common.js'
import { getFfmpegPath } from '../utils/common.js'
import axios from 'axios'
import { exec } from 'child_process'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { promisify } from 'util'
import { join } from 'path'

const execPromise = promisify(exec)

// 自定义错误类
class APIError extends Error {
    constructor(message, code) {
        super(message)
        this.code = code
        this.name = 'APIError'
    }
}

// 缓存类
class Cache {
    constructor() {
        this.store = new Map()
        this.ttl = 1000 * 60 * 30 // 30分钟缓存
    }

    set(key, value) {
        this.store.set(key, {
            value,
            timestamp: Date.now()
        })
    }

    get(key) {
        const item = this.store.get(key)
        if (!item) return null
        if (Date.now() - item.timestamp > this.ttl) {
            this.store.delete(key)
            return null
        }
        return item.value
    }

    clear() {
        this.store.clear()
    }
}

// API客户端类
class APIClient {
    static async request(url, options = {}) {
        try {
            const response = await axios({
                url,
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*',
                },
                ...options
            })
            return response.data
        } catch (error) {
            throw new APIError(
                error.response?.data?.error || '请求失败',
                error.response?.status
            )
        }
    }
}

// 统一错误处理
const handleError = async (e, error) => {
    console.error('Error:', error)
    const message = error instanceof APIError
        ? error.message
        : '系统错误，请稍后重试'
    await e.reply(message)
}

export class AnimeSearch extends plugin {
    constructor() {
        super({
            name: 'hanhan搜番剧',
            dsc: '使用trace.moe搜索动画片段',
            event: 'message',
            priority: 5,
            rule: [
                {
                    reg: '.*?#?(搜番剧|识番)|^#?(搜番剧|识番)',
                    fnc: 'searchAnime'
                }
            ]
        })
        // 初始化缓存目录
        this.tempDir = join(process.cwd(), 'temp/anime-search')
        if (!existsSync(this.tempDir)) {
            mkdirSync(this.tempDir, { recursive: true })
        }

        // 获取ffmpeg路径
        this.ffmpegPath = getFfmpegPath()

        this.cache = new Cache()
        this.apiClient = APIClient
        this.maxResults = 5
        this.pendingRequests = new Map()
        this.animeInfoQuery = `
            query ($id: Int) {
                Media (id: $id, type: ANIME) {
                    id
                    title {
                        native
                        romaji
                        english
                    }
                    synonyms
                    format
                    status
                    episodes
                    duration
                    genres
                    averageScore
                    popularity
                    season
                    seasonYear
                    startDate {
                        year
                        month
                        day
                    }
                    endDate {
                        year
                        month
                        day
                    }
                    description
                    coverImage {
                        large
                    }
                }
            }
        `
        // 添加工具方法
        this.common = {
            sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
            retry: async (fn, times = 3, delay = 1000) => {
                let error
                for (let i = 0; i < times; i++) {
                    try {
                        return await fn()
                    } catch (err) {
                        error = err
                        await this.common.sleep(delay)
                    }
                }
                throw error
            }
        }
    }

    // 检查 ffmpeg 是否可用
    async checkFfmpeg() {
        try {
            await execPromise(`${this.ffmpegPath} -version`)
            return true
        } catch (error) {
            console.error('FFmpeg not available:', error)
            return false
        }
    }

    async searchAnime(e) {
        try {
            const img = await this.getSourceImage(e) || e.img
            if (!img?.length) {
                throw new APIError('请发送要搜索的动画截图或回复包含图片的消息')
            }

            await e.reply('正在搜索中，请稍候...')

            const cacheKey = img[0]
            const cachedResult = this.cache.get(cacheKey)
            if (cachedResult) {
                return this.sendResult(e, cachedResult)
            }

            const result = await this.searchTraceMode(img[0])
            this.cache.set(cacheKey, result)
            await this.sendResult(e, result)
        } catch (error) {
            await handleError(e, error)
        }
    }

    async searchTraceMode(imageUrl) {
        try {
            const response = await this.apiClient.request('https://api.trace.moe/search', {
                params: { url: imageUrl },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            if (response.error) {
                throw new APIError(response.error)
            }

            // 获取所有唯一的 anilist IDs
            const anilistIds = [...new Set(response.result.map(item => item.anilist))]
            // 获取详细信息
            const animeDetails = await this.getAnimeDetails(anilistIds)

            return {
                frameCount: response.frameCount,
                error: response.error,
                result: response.result.map(item => ({
                    ...item,
                    details: animeDetails.find(detail => detail.id === item.anilist)
                }))
            }
        } catch (error) {
            throw new APIError('搜索服务请求失败')
        }
    }

    async downloadFile(url, outputPath) {
        try {
            const writer = createWriteStream(outputPath)
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: 30000
            })

            return new Promise((resolve, reject) => {
                response.data.pipe(writer)
                writer.on('finish', resolve)
                writer.on('error', reject)
            })
        } catch (error) {
            console.error('文件下载失败:', error)
            throw new Error('文件下载失败')
        }
    }
    async getAnimeDetails(ids) {
        try {
            const results = await Promise.all(ids.map(async id => {
                try {
                    const response = await axios.post('https://graphql.anilist.co', {
                        query: this.animeInfoQuery,
                        variables: { id }
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    })
                    return response.data?.data?.Media
                } catch (error) {
                    console.error(`获取ID ${id} 的动画详情失败:`, error)
                    return null
                }
            }))
            return results.filter(Boolean)
        } catch (error) {
            console.error('获取动画详情失败:', error)
            return []
        }
    }

    async batchRequest(requests, batchSize = 3) {
        const results = []
        for (let i = 0; i < requests.length; i += batchSize) {
            const batch = requests.slice(i, i + batchSize)
            const batchResults = await Promise.all(
                batch.map(req => this.apiClient.request(req.url, req.options))
            )
            results.push(...batchResults)
        }
        return results
    }

    // 修改发送结果方法
    async sendResult(e, result) {
        try {
            const messages = await this.formatSearchResults(result)
            if (!messages || messages.length === 0) {
                await e.reply('未找到匹配结果')
                return
            }

            if (messages.length > 1) {
                const validMessages = messages.filter(msg =>
                    Array.isArray(msg) && msg.length > 0 &&
                    msg.some(item => item !== null && item !== undefined)
                )

                if (validMessages.length === 0) {
                    await e.reply('搜索结果处理失败')
                    return
                }

                try {
                    // 使用common中的makeForwardMsg
                    const forwardMsg = await common.makeForwardMsg(e, validMessages, '搜番结果')
                    await e.reply(forwardMsg)
                } catch (err) {
                    console.error('发送转发消息失败:', err)
                    // 如果转发失败，尝试单条发送
                    for (let msg of validMessages) {
                        try {
                            await e.reply(msg)
                            await this.common.sleep(1500)
                        } catch (sendErr) {
                            console.error('发送单条消息失败:', sendErr)
                        }
                    }
                }
            } else {
                // 处理单条消息
                const message = messages[0]
                if (Array.isArray(message) && message.length > 0 &&
                    message.some(item => item !== null && item !== undefined)) {
                    await e.reply(message)
                } else {
                    await e.reply('搜索结果处理失败')
                }
            }
        } catch (error) {
            console.error('发送结果失败:', error)
            await e.reply('发送结果失败，请稍后重试')
        }
    }

    async getSourceImage(e) {
        // 获取回复消息或引用消息中的图片
        let source = ''
        let imgArr = []

        // 先检查是否有直接图片
        if (e.img?.length > 0) {
            return e.img
        }

        // 检查回复或引用的消息
        if (e.getReply) {
            source = await e.getReply()
        } else if (e.source) {
            if (e.group?.getChatHistory) {
                source = (await e.group.getChatHistory(e.source.seq, 1)).pop()
            } else if (e.friend?.getChatHistory) {
                source = (await e.friend.getChatHistory(e.source.time, 1)).pop()
            }
        }

        // 从source中获取图片
        if (source?.message) {
            for (let i of source.message) {
                if (i.type === 'image') {
                    imgArr.push(i.url)
                }
            }
        }

        // 如果没有找到图片但有at，使用被at用户的头像
        if (imgArr.length === 0 && e.at) {
            imgArr.push(`https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.at}`)
        }

        return imgArr.length > 0 ? imgArr : false
    }

    // 视频转GIF
    async convertVideoToGif(videoUrl) {
        try {
            if (!await this.checkFfmpeg()) {
                console.log('FFmpeg不可用，跳过GIF转换')
                return null
            }

            // 获取视频数据
            const videoResponse = await axios({
                url: videoUrl,
                responseType: 'arraybuffer'
            })

            // 设置ffmpeg命令
            const command = `${this.ffmpegPath} -i pipe:0 -vf "fps=10,scale=320:-1:flags=lanczos" -f gif pipe:1`

            try {
                // 使用pipe执行ffmpeg
                const { stdout, stderr } = await new Promise((resolve, reject) => {
                    const proc = exec(command, {
                        encoding: 'buffer',
                        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
                    })

                    const chunks = []
                    proc.stdout.on('data', chunk => chunks.push(chunk))

                    proc.stdin.write(videoResponse.data)
                    proc.stdin.end()

                    proc.on('close', code => {
                        if (code === 0) {
                            resolve({ stdout: Buffer.concat(chunks) })
                        } else {
                            reject(new Error(`FFmpeg exited with code ${code}`))
                        }
                    })
                })

                // 转换为base64
                const gifBase64 = stdout.toString('base64')
                return `base64://${gifBase64}`

            } catch (ffmpegError) {
                console.error('FFmpeg处理失败:', ffmpegError)
                return null
            }

        } catch (error) {
            console.error('视频转GIF处理失败:', error)
            return null
        }
    }

    // 下载文件
    async downloadFile(url, outputPath) {
        try {
            const writer = createWriteStream(outputPath)
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: 30000
            })

            return new Promise((resolve, reject) => {
                response.data.pipe(writer)
                writer.on('finish', resolve)
                writer.on('error', reject)
            })
        } catch (error) {
            console.error('文件下载失败:', error)
            throw new Error('文件下载失败')
        }
    }

    // 修改消息格式化方法
    async formatSearchResults(result) {
        if (!result?.result?.length) {
            return ['未找到匹配的动画片段']
        }

        const messages = []
        for (const [index, match] of result.result.slice(0, this.maxResults).entries()) {
            try {
                let messageContent = [`匹配结果 ${index + 1}：\n`]

                // 添加预览图片
                try {
                    const previewImage = await this.getImageBase64(match.image)
                    if (previewImage) {
                        messageContent.unshift(segment.image(`base64://${previewImage}`))
                    }
                } catch (error) {
                    console.error('获取预览图片失败:', error)
                }

                // 添加GIF预览
                try {
                    const gifBase64 = await this.convertVideoToGif(match.video)
                    if (gifBase64) {
                        messageContent.push(segment.image(gifBase64), '\n')
                    }
                } catch (error) {
                    console.error('GIF转换失败:', error)
                }

                // 基本信息
                messageContent.push(
                    `⌛ 时间点：${this.formatTime(match.from)} - ${this.formatTime(match.to)}\n`,
                    `🎯 相似度：${(match.similarity * 100).toFixed(1)}%\n`
                )

                // 详细信息
                if (match.details?.title) {
                    messageContent.push(
                        `📺 动画名称：${match.details.title.native || '未知'}\n`,
                        match.details.synonyms ? `🇨🇳 中文名称：${match.details.synonyms}\n` : '',
                        match.details.title.english ? `🌐 英文名称：${match.details.title.english}\n` : '',
                        match.details.title.romaji ? `🔤 罗马音：${match.details.title.romaji}\n` : '',
                        `💫 类型：${this.getAnimeFormat(match.details.format)}\n`,
                        `📝 状态：${this.getAnimeStatus(match.details.status)}\n`,
                        `💿 总集数：${match.details.episodes || '未知'}\n`
                    )

                    if (match.episode) {
                        messageContent.push(`📍 匹配集数：第${match.episode}集\n`)
                    }
                } else {
                    messageContent.push('❌ 未能获取详细信息\n')
                }

                // 过滤掉空值并添加到消息列表
                const validContent = messageContent.filter(Boolean)
                if (validContent.length > 0) {
                    messages.push(validContent)
                }

            } catch (error) {
                console.error(`处理结果 ${index + 1} 失败:`, error)
                messages.push([`❌ 结果 ${index + 1} 处理失败: ${error.message}`])
            }
        }
        return messages
    }

    // 优化图片
    async optimizeImage(inputBuffer) {
        try {
            return await sharp(inputBuffer)
                .resize(800, null, {
                    withoutEnlargement: true,
                    fit: 'inside'
                })
                .jpeg({
                    quality: 85,
                    progressive: true
                })
                .toBuffer()
        } catch (error) {
            console.error('图片优化失败:', error)
            return inputBuffer
        }
    }

    getAnimeFormat(format) {
        const formats = {
            TV: 'TV动画',
            TV_SHORT: 'TV短片',
            MOVIE: '剧场版',
            SPECIAL: '特别篇',
            OVA: 'OVA',
            ONA: 'ONA',
            MUSIC: '音乐视频',
        }
        return formats[format] || format || '未知'
    }

    getAnimeStatus(status) {
        const statuses = {
            FINISHED: '已完结',
            RELEASING: '放送中',
            NOT_YET_RELEASED: '未放送',
            CANCELLED: '已取消',
            HIATUS: '暂停中',
        }
        return statuses[status] || status || '未知'
    }

    getAnimeSeason(season) {
        const seasons = {
            WINTER: '冬季',
            SPRING: '春季',
            SUMMER: '夏季',
            FALL: '秋季',
        }
        return seasons[season] || season || '未知'
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = Math.floor(seconds % 60)
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    async getImageBase64(url) {
        try {
            const response = await this.apiClient.request(url, {
                responseType: 'arraybuffer'
            })
            return Buffer.from(response, 'binary').toString('base64')
        } catch (error) {
            throw new APIError('获取图片失败')
        }
    }
}