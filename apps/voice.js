import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import fetch from 'node-fetch'
import fs from 'node:fs'

const _path = process.cwd() + '/plugins/hanhan-plugin'

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
          reg: '^#?(撒娇|随机撒娇)$',
          fnc: 'sj'
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
    let url = 'https://api.yujn.cn/api/sjwyy.php?type=json'
    let response = await fetch(url) // 调用接口获取数据
    let result = await response.json()
    if (result.code != 200) {
      return e.reply('api寄了')
    }
    console.log(result)
    if (result.id) {
      await this.reply(segment.image(result.img))
      await this.reply(segment.record(result.url))
    } else {
      this.reply('随机到vip歌曲了，已自动随机下一首')
      this.sjwyy()
    }
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
    let path = `${_path}/resources/voice/lucha/`
    if (!fs.existsSync(path)) return this.e.reply(`未发现本地语音`)
    const files = fs.readdirSync(path)  
    path = `${path}${files[Math.floor(Math.random() * files.length)]}`
    await this.reply(segment.record(path))
    await this.is_MD(e)
    return true // 返回true 阻挡消息不再往下
  }

    // 御姐撒娇语音包
  async sj (e) {
    let path = `${_path}/resources/voice/yujie/`
    if (!fs.existsSync(path)) return this.e.reply(`未发现本地语音`)
    const files = fs.readdirSync(path)  
    path = `${path}${files[Math.floor(Math.random() * files.length)]}`
    await this.reply(segment.record(path))
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
