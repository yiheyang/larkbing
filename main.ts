import * as lark from '@larksuiteoapi/node-sdk'
import nodeCache from 'node-cache'
import dotenv from 'dotenv'
import {
  BingChat,
  ChatMessageFull,
  ChatMessagePartial, SourceAttribution, SuggestedResponse
} from './lib'
import { InteractiveCardActionEvent } from '@larksuiteoapi/node-sdk'
import * as http from 'http'

const cache = new nodeCache()

dotenv.config()
const env = process.env

const server = http.createServer()

const client = new lark.Client({
  appId: env.LARK_APP_ID || '',
  appSecret: env.LARK_APP_SECRET || '',
  domain: env.LARK_DOMAIN || lark.Domain.Feishu
})

const session: Record<string, BingChat> = {}

async function reply (
  messageID: string, content: string) {
  try {
    return await client.im.message.reply({
      path: {
        message_id: messageID
      },
      data: {
        content: JSON.stringify({
          'text': content
        }),
        msg_type: 'text'
      }
    })
  } catch (error) {
    errorHandler(error)
  }
}

const generateCard = (
  messages: (ChatMessagePartial | ChatMessageFull)[], updating: boolean) => {
  interface Note {
    type: 'note'
    text: string
  }

  interface Answer {
    type: 'answer',
    text: string
  }

  let messageItems: (Note | Answer)[] = []
  let referenceItems: SourceAttribution[] | undefined
  let suggestedItems: SuggestedResponse[] | undefined

  for (const message of messages) {
    if (message.messageType === 'RenderCardRequest' || !message.text) {
      // do nothing
    } else if (message.messageType) {
      let emoji: string
      if (message.text.includes('Searching')) {
        emoji = '🔍'
      } else if (message.text.includes('Generating')) {
        emoji = '🤖️'
      } else {
        emoji = '💡'
      }
      const text = `${emoji} ** ${message.text.replace(/`/g, '*')} **`
      messageItems.push({
        type: 'note',
        text
      })
    } else if (!message.messageType && message.author === 'user') {
      const text = `🗣️ ** Question: ${message.text} **`
      messageItems.push({
        type: 'note',
        text
      })
    } else if (!message.messageType && message.author === 'bot') {
      referenceItems = message.sourceAttributions
      suggestedItems = message.suggestedResponses
      let text = message.text
      let reg = RegExp(/\[\^([0-9]+)\^]/g)
      let result
      while (result = reg.exec(message.text)) {
        const index = result[1]
        text = text.replace(`[^${index}^]`,
          (referenceItems && referenceItems[Number(index) - 1])
            ? ` [[${index}]]` +
            `(${referenceItems[Number(index) - 1].seeMoreUrl})`
            : ` [${index}]`)
      }

      text = text.replace(/\[\^([0-9]+|)(\^|)/g, '')

      reg = RegExp(/```(\w+)\n/g)
      while (result = reg.exec(message.text)) {
        const language = result[1]
        text = text.replace('```' + language + '\n',
          `**💾  ${language.toUpperCase()} CODE**\n━━━━━━━━━━━━\n`)
      }

      text = text.replace(/\n```/g, '\n━━━━━━━━━━━━')

      text = text.replace(/\n- /g, '\n🔹 ')

      messageItems.push({
        type: 'answer',
        text
      })
    }
  }

  const result = {
    'config': {
      'wide_screen_mode': true,
      'update_multi': true
    },
    'header': {
      'title': {
        'tag': 'plain_text',
        'content': 'Updating... ⚙️'
      },
      'template': 'blue'
    } as any,
    'elements': [] as any[]
  }

  if (!updating) {
    delete result.header
  }

  for (const messageItem of messageItems) {
    if (messageItem.type === 'note') {
      result.elements.push({
        'tag': 'note',
        'elements': [
          {
            'tag': 'lark_md',
            'content': messageItem.text
          }
        ]
      })
    } else if (messageItem.type === 'answer') {
      if (result.elements.length > 0) {
        result.elements.push({
          'tag': 'hr'
        })
      }
      result.elements.push({
        'tag': 'markdown',
        'content': messageItem.text
      })
    }
  }

  if (referenceItems && referenceItems.length > 0) {
    result.elements.push({
      'tag': 'hr'
    })

    const referenceOptions = referenceItems.map((referenceItem, index) => {
      return {
        'text': {
          'tag': 'plain_text',
          'content': `[${index + 1}] ` +
            (referenceItem.providerDisplayName || referenceItem.searchQuery)
        },
        'value': referenceItem.seeMoreUrl,
        'url': referenceItem.seeMoreUrl
      }
    })

    result.elements.push({
      'tag': 'div',
      'text': {
        'tag': 'lark_md',
        'content': '**Learn more** / Reference 👉'
      },
      'extra': {
        'tag': 'overflow',
        'options': referenceOptions
      }
    })
  }

  if (suggestedItems && suggestedItems.length > 0) {
    const suggestedActions = suggestedItems.map((suggestedItem) => {
      return suggestedItem.text && {
        'tag': 'button',
        'value': {
          'text': `ASK----${suggestedItem.text}`
        },
        'text': {
          'tag': 'plain_text',
          'content': suggestedItem.text
        },
        'type': 'primary'
      }
    }).filter(Boolean)

    result.elements.push({
      'tag': 'action',
      'actions': suggestedActions
    })
  }

  return JSON.stringify(result)
}

async function replyCard (
  messageID: string, chatMessage: (ChatMessagePartial | ChatMessageFull)[],
  updating: boolean) {
  try {
    return await client.im.message.reply({
      path: {
        message_id: messageID
      },
      data: {
        content: generateCard(chatMessage, updating),
        msg_type: 'interactive'
      }
    })
  } catch (error) {
    errorHandler(error)
  }
}

async function updateCard (
  messageID: string, chatMessage: (ChatMessagePartial | ChatMessageFull)[],
  updating = false) {
  try {
    return await client.im.message.patch({
      path: {
        message_id: messageID
      },
      data: {
        content: generateCard(chatMessage, updating)
      }
    })
  } catch (error) {
    errorHandler(error)
  }
}

function errorHandler (error: any) {
  if (error.response) {
    const errorMessage = `[ERROR:${error.response.status}] ${JSON.stringify(
      error.response.data)}`
    console.warn(errorMessage)
    return errorMessage
  } else if (error.message) {
    const errorMessage = `[ERROR] ${error.message}`
    console.warn(errorMessage)
    return errorMessage
  } else {
    const errorMessage = `[ERROR] ${env.LARK_APP_NAME} is unavailable now. Please try again later.`
    console.warn(`[ERROR] Unknown error occurred.`)
    return errorMessage
  }
}

async function createCompletion (
  userID: string, question: string,
  onProgress?: (partialMessage: ChatMessagePartial[]) => void) {
  console.info(`[${env.LARK_APP_NAME}] Receive from ${userID}: ${question}`)

  try {
    if (!session[userID]) session[userID] = new BingChat()

    const chat = session[userID]

    const result = await chat.sendMessage(question, { onProgress })
    console.info(`[${env.LARK_APP_NAME}] Reply to ${userID}`)

    return result
  } catch (error: any) {
    throw errorHandler(error)
  }
}

const messageHandler = async (
  content: string, userID: string, messageID: string) => {
  try {
    if (content === '/reset') {
      delete session[userID]
      return await reply(messageID, '[COMMAND] Session reset successfully.')
    } else {
      let cardID: string | undefined
      let replyStatus: 'noReply' | 'replying' | 'replied' | 'end' | string = 'noReply'
      let chatMessage: ChatMessageFull[] | undefined
      const onProgress = async (partialMessage: ChatMessagePartial[]) => {
        if (replyStatus === 'replying' || replyStatus === 'end') return
        if (!cardID) {
          replyStatus = 'replying'
          cardID = (await replyCard(messageID,
            partialMessage, true))?.data?.message_id
          replyStatus = 'replied'
          if (chatMessage) {
            replyStatus = 'end'
            await updateCard(cardID!, chatMessage, false)
          }
        } else if (replyStatus !== 'end') {
          await updateCard(cardID, partialMessage, true)
        }
      }
      chatMessage = await createCompletion(userID, content, onProgress)
      if (replyStatus === 'noReply') {
        replyStatus = 'end'
        await replyCard(messageID, chatMessage, false)
      }

      if (replyStatus === 'replied') {
        replyStatus = 'end'
        await updateCard(cardID!, chatMessage,
          false)
      }
      return
    }
  } catch (errorMessage) {
    if (typeof errorMessage === 'string') {
      return await reply(messageID, errorMessage)
    }
  }
}

const eventDispatcher = new lark.EventDispatcher({
  encryptKey: env.LARK_ENCRYPT_KEY
}).register({
  'im.message.receive_v1': async (data) => {
    // check time range
    let currentTime = Date.now()
    if (currentTime - Number(data.message.create_time) > 60 *
      1000) return { code: 0 }

    // handle each message only once
    const messageID = data.message.message_id
    if (!!cache.get(`message_id:${messageID}`)) return { code: 0 }
    cache.set(`message_id:${messageID}`, true, 3600)

    const userID = data.sender.sender_id?.user_id || 'common'

    // private chat
    if (data.message.chat_type === 'p2p') {
      if (data.message.message_type === 'text') {
        const userInput = JSON.parse(data.message.content)
        await messageHandler(userInput.text, userID, messageID)
      }
    }

    // group chat, need to @ bot
    if (data.message.chat_type === 'group') {
      if (data.message.mentions &&
        data.message.mentions.length > 0 && data.message.mentions[0].name ===
        env.LARK_APP_NAME) {
        const userInput = JSON.parse(data.message.content)
        await messageHandler(
          userInput.text.replace(/@_user_[0-9]+/g, '').trim(), userID,
          messageID)
      }

    }
    return { code: 0 }
  }
})

const cardDispatcher = new lark.CardActionHandler(
  {
    encryptKey: env.LARK_ENCRYPT_KEY,
    verificationToken: env.LARK_VERIFICATION_TOKEN
  },
  async (data: InteractiveCardActionEvent) => {
    if (data.action.tag === 'button' &&
      data.action.value.text.startsWith('ASK----')) {
      const userID = data.user_id!
      const messageID = data.open_message_id
      messageHandler(data.action.value.text.replace('ASK----', ''),
        userID, messageID).then()
    }
    return null
  }
)

server.on('request',
  lark.adaptDefault('/event', eventDispatcher, { autoChallenge: true }))
server.on('request',
  lark.adaptDefault('/card', cardDispatcher, { autoChallenge: true }))

server.listen(env.PORT)
console.info(`[${env.LARK_APP_NAME}] Now listening on port ${env.PORT}`)
