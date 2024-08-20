import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import fetch from 'node-fetch'

export class voice extends plugin {
  constructor () {
    super({
      name: '憨憨语音类',
      dsc: '憨憨语音类',
      event: 'message',
      priority: 6,
      rule: [
        {
          reg: '^#?(唱鸭|随机唱鸭)$',
          fnc: 'sjcy'
        },
        {
          reg: '^#?(坤坤语音|随机坤坤)$',
          fnc: 'sjkk'
        },
        {
          reg: '^#?(网易云|随机网易云)$',
          fnc: 'sjwyy'
        },
        {
          reg: '^#?骂我$',
          fnc: 'maren'
        },
        {
          reg: '^#?(绿茶|随机绿茶)$',
          fnc: 'lvcha'
        },
        {
          reg: '^#?语音类菜单$',
          fnc: 'helps'
        }
      ]
    })
  }

  async helps (e) {
    if (e.bot.config?.markdown?.type) { return await this.reply('按钮菜单') }
  }

  // 随机网易云
  async sjwyy (e) {
    const maxAttempts = 3 // 最大重试次数
    let attempts = 0 // 当前尝试次数
    let url = 'https://api.yujn.cn/api/sjwyy.php?type=json'

    while (attempts < maxAttempts) {
      let response = await fetch(url) // 调用接口获取数据
      let result = await response.json()

      if (result.code != 200) {
        return e.reply('api寄了')
      }

      console.log(result)

      if (result.id) {
        await this.reply(segment.image(result.img))
        await this.reply(segment.record(result.url))
        return // 成功获取到歌曲，结束函数
      } else {
        this.reply('随机到vip歌曲了，已自动随机下一首')
        attempts++ // 增加尝试次数
      }
    }

    // 达到最大重试次数
    this.reply('已达到最大重试次数，无法获取歌曲。')
  }

  // 随机唱鸭
  async sjcy (e) {
    // 发送消息
    await this.reply(segment.record('http://api.yujn.cn/api/changya.php?type=mp3'))
    await this.is_MD(e)
    return true // 返回true 阻挡消息不再往下
  }

  // 随机坤坤
  async sjkk (e) {
    // 发送消息
    await this.reply(segment.record('http://api.yujn.cn/api/sjkunkun.php?'))
    await this.is_MD(e)
    return true // 返回true 阻挡消息不再往下
  }

  // 随机语音骂人
  async maren (e) {
    // 发送消息
    await this.reply(segment.record('http://api.yujn.cn/api/maren.php?'))
    await this.is_MD(e)
    return true // 返回true 阻挡消息不再往下
  }

  // 绿茶语音包
  async lvcha (e) {
    await this.reply(segment.record('https://api.yujn.cn/api/lvcha.php?'))
    await this.is_MD(e)
    return true // 返回true 阻挡消息不再往下
  }

  async reply (message) {
    return await this.e.reply(message, false, { recallMsg: Config.recall_s })
  }

  async is_MD (e) {
    if (Config.enableButton || false) {
      if (!(Config.buttonWhiteGroups.includes(e.group_id))) { return false }
    }
    if (e.bot.config?.markdown?.type) { return await this.reply('语音类菜单') }
  }
}
