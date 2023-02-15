import express from 'express'
import * as lark from '@larksuiteoapi/node-sdk'
import bodyParser from 'body-parser'
import nodeCache from 'node-cache'
import dotenv from 'dotenv'
import { BingChat } from './lib'

const cache = new nodeCache()

dotenv.config()
const env = process.env

const app = express()
app.use(bodyParser.json())

const client = new lark.Client({
  appId: env.LARK_APP_ID || '',
  appSecret: env.LARK_APP_SECRET || '',
  domain: env.LARK_DOMAIN || lark.Domain.Feishu
})

const session: Record<string, BingChat>  = {}

async function reply (
  messageID: string, content: string) {
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

async function createCompletion (userID: string, question: string) {
  console.info(`[${env.LARK_APP_NAME}] Receive from ${userID}: ${question}`)

  try {
    if(!session[userID]) session[userID] = new BingChat()

    const chat = session[userID]

    const result = await chat.sendMessage(question)
    const answer = result.text.trim()
    console.info(`[${env.LARK_APP_NAME}] Reply to ${userID}: ${answer}`)

    return answer
  } catch (error: any) {
    throw errorHandler(error)
  }
}

const eventDispatcher = new lark.EventDispatcher({
  encryptKey: env.LARK_ENCRYPT_KEY
}).register({
  'im.message.receive_v1': async (data) => {
    // handle each message only once
    const messageID = data.message.message_id
    if (!!cache.get(`message_id:${messageID}`)) return { code: 0 }
    cache.set(`message_id:${messageID}`, true, 3600)

    const userID = data.sender.sender_id?.user_id || 'common'

    const messageHandler = async (content: string) => {
      try {
        if (content === '/reset') {
          delete session[userID]
          return await reply(messageID, '[COMMAND] Session reset successfully.')
        } else {
          const answer = await createCompletion(userID, content)
          return await reply(messageID, answer)
        }
      } catch (errorMessage) {
        if (typeof errorMessage === 'string') {
          return await reply(messageID, errorMessage)
        }
      }
    }

    // private chat
    if (data.message.chat_type === 'p2p') {
      if (data.message.message_type === 'text') {
        const userInput = JSON.parse(data.message.content)
        await messageHandler(userInput.text)
      }
    }

    // group chat, need to @ bot
    if (data.message.chat_type === 'group') {
      if (data.message.mentions &&
        data.message.mentions.length > 0 && data.message.mentions[0].name ===
        env.LARK_APP_NAME) {
        const userInput = JSON.parse(data.message.content)
        await messageHandler(userInput.text.replace(/@_user_[0-9]+/g, '').trim())
      }

    }
    return { code: 0 }
  }
})

app.use('/', lark.adaptExpress(eventDispatcher, {
  autoChallenge: true
}))

app.listen(env.PORT, () => {
  console.info(`[${env.LARK_APP_NAME}] Now listening on port ${env.PORT}`)
})
