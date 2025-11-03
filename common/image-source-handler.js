import { debuglog } from './log.js';

/**
 * 从消息事件对象(e)中提取图片URL
 * 逻辑优先级：
 * 1. 当前消息中直接包含的图片 (e.img)
 * 2. 回复的消息中包含的图片 (e.source - ICQQ原生 / e.reply_id - OneBotv11适配器)
 * 3. @某人时，获取其头像（最后优先级）
 * @param {object} e 消息事件对象
 * @returns {string|null} - 返回找到的第一个图片URL，未找到则返回null
 */
export async function getSourceImage(e) {
    // 优先级1: 直接包含的图片
    if (e.img && e.img.length > 0) {
        debuglog('从 e.img 中获取到图片');
        return e.img[0];
    }

    // 优先级2: ICQQ原生 - 从回复消息中获取图片
    if (e.source) {
        debuglog('尝试从回复消息中获取图片 (ICQQ原生)...');
        let reply;
        try {
            if (e.isGroup) {
                const chatHistory = await e.group.getChatHistory(e.source.seq, 1);
                reply = chatHistory.pop()?.message;
            } else {
                const chatHistory = await e.friend.getChatHistory(e.source.time, 1);
                reply = chatHistory.pop()?.message;
            }
        } catch (error) {
            debuglog('获取历史消息失败:', error);
        }

        if (reply) {
            for (const val of reply) {
                if (val.type === 'image') {
                    debuglog('从回复消息中获取到图片');
                    return val.url;
                }
            }
        }
    }

    // 优先级3: OneBotv11适配器 - 从回复消息中获取图片
    if (e.reply_id) {
        debuglog('尝试从回复消息中获取图片 (OneBotv11适配器)...');
        try {
            const replyMsg = await e.getReply(e.reply_id);
            if (replyMsg?.message) {
                for (const val of replyMsg.message) {
                    if (val.type === 'image') {
                        debuglog('从回复消息中获取到图片 (OneBotv11)');
                        return val.url;
                    }
                }
            }
        } catch (error) {
            debuglog('获取回复消息失败:', error);
        }
    }

    // 优先级4: @ 获取头像（最后优先级）
    if (e.at) {
        debuglog('尝试从 @ 对象中获取头像...');
        try {
            if (e.atBot) {
                // @ 机器人时，获取机器人头像
                const avatarUrl = e.bot?.avatar || `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.self_id}`;
                debuglog('从 @ 机器人中获取到头像');
                return avatarUrl;
            }

            if (e.at && e.isGroup) {
                // @ 群成员时，尝试获取真实头像URL
                try {
                    const avatarUrl = await e.group.pickMember(e.at).getAvatarUrl();
                    debuglog('从 @ 群成员中获取到头像');
                    return avatarUrl;
                } catch (error) {
                    debuglog('获取群成员头像URL失败，使用固定格式:', error);
                    return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.at}`;
                }
            } else if (e.at) {
                // 好友消息中 @（这种情况较少见，但保持兼容）
                return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.at}`;
            }
        } catch (error) {
            debuglog('获取 @ 头像失败:', error);
            // 降级到固定URL格式
            if (e.at) {
                return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.at}`;
            }
        }
    }

    debuglog('在消息中未找到任何可用图片');
    return null;
}