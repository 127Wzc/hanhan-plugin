import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import fs from 'fs'
import path from 'path'

// 统一路径配置
const PATHS = {
  BASE: process.cwd(),
  PLUGIN: '/plugins/hanhan-plugin/resources/tp-bq',
  get BQ() { return path.join(this.PLUGIN, 'pictures/') },
  get QLDT() { return path.join(this.PLUGIN, 'qldt/') },
  get DT() { return path.join(this.PLUGIN, 'dt/') }
}

export class MediaHandler extends plugin {
  constructor() {
    super({
      name: '憨憨媒体',
      dsc: '发送随机表情/图片/视频',
      event: 'message',
      priority: 49,
      rule: [
        {
          reg: '^#?来张(表情图|表情)$',
          fnc: 'sendRandomImage',
          params: ['BQ']
        },
        {
          reg: '^#?(叼|吊|屌|沙雕)发言$', 
          fnc: 'sendRandomImage',
          params: ['QLDT']
        },
        {
          reg: '^#?来张(叼|雕|吊)图$',
          fnc: 'sendRandomImage', 
          params: ['DT']
        },
        {
          reg: '^#?原神(，|,)启动(！|!)$',
          fnc: 'sendVideo'
        }
      ]
    })
  }

  // 获取随机图片
  getRandomFile(dir) {
    try {
      const files = fs.readdirSync(path.join(PATHS.BASE, dir))
      return files[Math.floor(Math.random() * files.length)]
    } catch (err) {
      logger.error(`读取目录失败: ${err}`)
      return null
    }
  }

  // 发送随机图片
  async sendRandomImage() {
    logger.info('[用户命令]')
    const dir = PATHS[this.rule.params[0]]
    const file = this.getRandomFile(dir)
    
    if(!file) {
      return await this.reply('获取图片失败')
    }

    return await this.reply(
      segment.image(`file:///${path.join(PATHS.BASE, dir, file)}`)
    )
  }

  // 发送视频
  async sendVideo() {
    logger.info('[用户命令]')
    return await this.reply(
      segment.video(`file:///${path.join(PATHS.BASE, PATHS.PLUGIN, 'ysqd.mp4')}`)
    )
  }

  // 统一回复处理
  async reply(message) {
    return await this.e.reply(message, false, { 
      recallMsg: Config.recall_s 
    })
  }
}