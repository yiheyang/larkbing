import crypto from 'crypto'
import WebSocket from 'ws'
import dotenv from 'dotenv'
import * as types from './types'

dotenv.config()
const env = process.env

const cookie = env.BING_COOKIE || ''
const terminalChar = String.fromCharCode(30)

export class BingChat {
  constructor () {
    if (!cookie) {
      throw new Error('Bing cookie is required')
    }
  }

  ws!: WebSocket

  send (content: any) {
    this.ws.send(JSON.stringify(content) + terminalChar)
  }

  cleanup () {
    this.ws.close()
    this.ws.removeAllListeners()
  }

  async sendMessage (
    text: string,
    opts: types.SendMessageOptions = {}
  ): Promise<types.ChatMessage> {
    const {
      invocationId = '1',
      onProgress,
      locale = 'zh-CN',
      market = 'en-US',
      region = 'US',
      location
    } = opts

    let { conversationId, clientId, conversationSignature } = opts
    const isStartOfSession = !conversationId || !clientId ||
      !conversationSignature

    if (!conversationId || !clientId || !conversationSignature) {
      const conversation = await this.createConversation()
      conversationId = conversation.conversationId
      clientId = conversation.clientId
      conversationSignature = conversation.conversationSignature
    }

    const result: types.ChatMessage = {
      author: 'bot',
      id: crypto.randomUUID(),
      conversationId,
      clientId,
      conversationSignature,
      invocationId: `${parseInt(invocationId, 10) + 1}`,
      text: ''
    }

    const responseP = new Promise<types.ChatMessage>(
      async (resolve, reject) => {

        let isFulfilled = false

        this.ws = new WebSocket(
          env.BING_WS_URL || 'wss://sydney.bing.com/sydney/ChatHub', {
            perMessageDeflate: false,
            headers: {
              'accept-language': 'en-US,en;q=0.9',
              'cache-control': 'no-cache',
              pragma: 'no-cache'
            }
          })

        this.ws.on('error', (error) => {
          console.warn('WebSocket error:', error)
          this.cleanup()
          if (!isFulfilled) {
            isFulfilled = true
            reject(new Error(`WebSocket error: ${error.toString()}`))
          }
        })
        this.ws.on('close', () => {
          // TODO
        })

        this.ws.on('open', () => {
          this.send({ protocol: 'json', version: 1 })
        })
        let stage = 0

        this.ws.on('message', (data) => {
          const objects = data.toString().split(terminalChar)
          console.log('message', objects)
          const messages = objects.map((object) => {
            try {
              return JSON.parse(object)
            } catch (error) {
              return object
            }
          }).filter(Boolean)

          if (!messages.length) {
            return
          }

          if (stage === 0) {
            this.send({type:6})

            const traceId = crypto.randomBytes(16).toString('hex')

            // example location: 'lat:47.639557;long:-122.128159;re=1000m;'
            const locationStr = location
              ? `lat:${location.lat};long:${location.lng};re=${
                location.re || '1000m'
              };`
              : undefined

            const params = {
              arguments: [
                {
                  source: 'cib',
                  optionsSets: [
                    'nlu_direct_response_filter',
                    'deepleo',
                    'enable_debug_commands',
                    'disable_emoji_spoken_text',
                    'responsible_ai_policy_235',
                    'enablemm'
                  ],
                  allowedMessageTypes: [
                    'Chat',
                    'InternalSearchQuery',
                    'InternalSearchResult',
                    'InternalLoaderMessage',
                    'RenderCardRequest',
                    'AdsQuery',
                    'SemanticSerp'
                  ],
                  sliceIds: [],
                  traceId,
                  isStartOfSession,
                  message: {
                    locale,
                    market,
                    region,
                    location: locationStr,
                    author: 'user',
                    inputMethod: 'Keyboard',
                    messageType: 'Chat',
                    text
                  },
                  conversationSignature,
                  participant: { id: clientId },
                  conversationId
                }
              ],
              invocationId,
              target: 'chat',
              type: 4
            }

            this.send(params)

            ++stage
            return
          }

          for (const message of messages) {
            // console.log(JSON.stringify(message, null, 2))

            if (message.type === 1) {
              const update = message as types.ChatUpdate
              const msg = update.arguments[0].messages[0]

              // console.log('RESPONSE0', JSON.stringify(update, null, 2))

              if (!msg.messageType) {
                result.author = msg.author
                result.text = msg.text
                result.detail = msg

                onProgress?.(result)
              }
            } else if (message.type === 2) {
              const response = message as types.ChatUpdateCompleteResponse
              const validMessages = response.item.messages?.filter(
                (m) => !m.messageType
              )
              const lastMessage = validMessages?.[validMessages?.length - 1]

              if (lastMessage) {
                result.conversationId = response.item.conversationId
                result.conversationExpiryTime =
                  response.item.conversationExpiryTime

                result.author = lastMessage.author
                result.text = lastMessage.text
                result.detail = lastMessage

                if (!isFulfilled) {
                  isFulfilled = true
                  resolve(result)
                }
              }
            } else if (message.type === 3) {
              if (!isFulfilled) {
                isFulfilled = true
                resolve(result)
              }

              this.cleanup()
              return
            } else {
              // TODO: handle other message types
              // these may be for displaying "adaptive cards"
              // console.warn('unexpected message type', message.type, message)
            }
          }
        })
      }
    )

    return responseP
  }

  async createConversation (): Promise<types.ConversationResult> {
    const requestId = crypto.randomUUID()

    return fetch('https://www.bing.com/turing/conversation/create', {
      headers: {
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/json',
        'sec-ch-ua':
          '"Not_A Brand";v="99", "Microsoft Edge";v="109", "Chromium";v="109"',
        'sec-ch-ua-arch': '"x86"',
        'sec-ch-ua-bitness': '"64"',
        'sec-ch-ua-full-version': '"109.0.1518.78"',
        'sec-ch-ua-full-version-list':
          '"Not_A Brand";v="99.0.0.0", "Microsoft Edge";v="109.0.1518.78", "Chromium";v="109.0.5414.120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"12.6.0"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-edge-shopping-flag': '1',
        'x-ms-client-request-id': requestId,
        'x-ms-useragent':
          'azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.0 OS/MacIntel',
        cookie: (cookie).includes(';') ? cookie : `_U=${cookie}`
      },
      referrer: 'https://www.bing.com/search',
      referrerPolicy: 'origin-when-cross-origin',
      body: null,
      method: 'GET',
      mode: 'cors',
      credentials: 'include'
    }).then((res) => {
      if (res.ok) {
        return res.json()
      } else {
        throw new Error(
          `unexpected HTTP error createConversation ${res.status}: ${res.statusText}`
        )
      }
    })
  }
}
