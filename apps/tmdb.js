import { recallSendForwardMsg } from '../utils/common.js'
import plugin from '../../../lib/plugins/plugin.js'
import HttpsProxyAgent from 'https-proxy-agent'
import { Config } from '../utils/config.js'
import fetch from 'node-fetch'

const MESSAGES = {
  SEARCHING: '查询中',
  NO_KEY: '未检测到key！请前往 https://developer.themoviedb.org/docs 注册账号，使用 #憨憨设置tmdb key= 命令进行设置',
  NO_RESULTS: '未找到相关结果',
  TITLE: '查询结果'
}

const API_ENDPOINTS = {
  TV_SEARCH: 'search/tv',
  MOVIE_SEARCH: 'search/movie',
  PERSON_SEARCH: 'search/person',
  UPCOMING_MOVIES: 'movie/upcoming',
  NOW_PLAYING: 'movie/now_playing',
  TRENDING_MOVIE: 'trending/movie/week',
  TRENDING_TV: 'trending/tv/week'
}

export class Photo extends plugin {
  constructor() {
    super({
      name: 'tmdb',
      dsc: 'tmdb',
      event: 'message',
      priority: 6,
      rule: [
        { reg: '^#?搜番(.*)$', fnc: 'searchTV' },
        { reg: '^#?电影未来视$', fnc: 'upcomingMovies' },
        { reg: '^#?搜电影(.*)$', fnc: 'searchMovies' },
        { reg: '^#?搜导演(.*)$', fnc: 'searchPerson' },
        { reg: '^#?正在放映的电影$', fnc: 'nowPlayingMovies' },
        { reg: '^#?本周电影排行$', fnc: 'trendingMovies' },
        { reg: '^#?本周tv排行$', fnc: 'trendingTV' }
      ]
    })
    this.initConfig()
  }

  initConfig() {
    this.key = Config.tmdbkey
    this.proxyUrl = Config.proxyUrl
    this.r18 = Config.tmdb_r18 || false
    this.baseUrl = 'https://api.themoviedb.org/3'
    this.imageBaseUrl = 'https://image.tmdb.org/t/p/w500'
  }

  async fetchTMDBApi(endpoint, params = {}) {
    if (!this.key) {
      return { error: MESSAGES.NO_KEY }
    }

    try {
      const queryString = new URLSearchParams({
        language: 'zh-CN',
        page: '1',
        include_adult: this.r18,
        ...params
      }).toString()

      const url = `${this.baseUrl}/${endpoint}?${queryString}`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${this.key}`
        },
        agent: this.proxyUrl? new HttpsProxyAgent(this.proxyUrl) : null
      })

      return await response.json()
    } catch (error) {
      console.error('API Error:', error)
      return { error: 'API请求失败' }
    }
  }

  formatMessage(item, index, type) {
    const common = {
      language: `使用语言: ${item.original_language}`,
      score: `评分: ${item.vote_average}`,
      overview: `剧情简介: \n${item.overview}`,
      index: `-----第${index + 1}部-------`
    }

    const formats = {
      tv: {
        title: `中文名: ${item.name}`,
        originalTitle: `原著名称: ${item.original_name}`,
        region: `发行地区: ${item.origin_country}`,
        adult: `是否R-18: ${item.adult}`,
        date: `发行日期: ${item.first_air_date}`
      },
      movie: {
        title: `中文名: ${item.title}`,
        originalTitle: `原著名称: ${item.original_title}`,
        date: `上映日期: ${item.release_date}`,
        adult: `是否R-18: ${item.adult}`
      },
      person: {
        name: `导演名: ${item.name}`,
        birthday: `出生日期: ${item.birthday || '未知'}`,
        birthplace: `出生地: ${item.place_of_birth || '未知'}`,
        works: this.formatWorks(item.known_for)
      }
    }

    const format = formats[type]
    return Object.values({ ...common, ...format })
      .filter(Boolean)
      .join('\n') + '\n---------------------------\n'
  }

  formatWorks(works = []) {
    if (!works.length) return ''
    return '作品列表:\n' + works.map((work, index) =>
      `-----代表作${index + 1}-----\n` +
      `译名: ${work.title}\n` +
      `原著名称：${work.original_title}\n` +
      `发行日期：${work.release_date}`
    ).join('\n')
  }

  async handleResults(e, results, type) {
    if (!results || results.error) {
      await this.reply(results?.error || MESSAGES.NO_RESULTS)
      return false
    }

    if (results.length === 0) {
      await this.reply(MESSAGES.NO_RESULTS)
      return false
    }

    await this.reply(`共找到${results.length}条信息，资源获取中...`, true)

    const forwardMsgs = results.map((item, index) => [
      segment.image(`${this.imageBaseUrl}${item.poster_path || item.profile_path}`),
      this.formatMessage(item, index, type)
    ]).flat()

    return this.reply(await recallSendForwardMsg(e, forwardMsgs, false, MESSAGES.TITLE))
  }

  async execSearch(e, endpoint, params = {}, type) {
    await this.reply(MESSAGES.SEARCHING, true, { recallMsg: e.isGroup ? 3 : 0 })
    const data = await this.fetchTMDBApi(endpoint, params)
    return this.handleResults(e, data.results, type)
  }

  // 各个功能实现
  async searchTV(e) {
    const query = e.msg.replace(/^#?搜番/, '').trim()
    return this.execSearch(e, API_ENDPOINTS.TV_SEARCH, { query }, 'tv')
  }

  async searchMovies(e) {
    const query = e.msg.replace(/^#?搜电影/, '').trim()
    return this.execSearch(e, API_ENDPOINTS.MOVIE_SEARCH, { query }, 'movie')
  }

  async searchPerson(e) {
    const query = e.msg.replace(/^#?搜导演/, '').trim()
    return this.execSearch(e, API_ENDPOINTS.PERSON_SEARCH, { query }, 'person')
  }

  async upcomingMovies(e) {
    return this.execSearch(e, API_ENDPOINTS.UPCOMING_MOVIES, { region: 'CN' }, 'movie')
  }

  async nowPlayingMovies(e) {
    return this.execSearch(e, API_ENDPOINTS.NOW_PLAYING, { region: 'CN' }, 'movie')
  }

  async trendingMovies(e) {
    return this.execSearch(e, API_ENDPOINTS.TRENDING_MOVIE, {}, 'movie')
  }

  async trendingTV(e) {
    return this.execSearch(e, API_ENDPOINTS.TRENDING_TV, {}, 'tv')
  }
}