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

  ws?: WebSocket

  conversationExpired = true
  conversationId?: string
  clientId?: string
  conversationSignature?: string
  isStartOfSession = true

  conversationTimer?: NodeJS.Timeout
  respondTimer?: NodeJS.Timeout

  send (content: any) {
    this.ws!.send(JSON.stringify(content) + terminalChar)
  }

  keepalive () {
    this.send({ type: 6 })
  }

  cleanup () {
    this.conversationTimer && clearTimeout(this.conversationTimer)
    this.respondTimer && clearTimeout(this.respondTimer)
    this.ws!.terminate()
    this.ws = undefined
    this.conversationExpired = true
    this.conversationId = undefined
    this.clientId = undefined
    this.conversationSignature = undefined
    this.isStartOfSession = true
    this.conversationTimer = undefined
    this.respondTimer = undefined
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

    if (this.conversationExpired) await this.initConversation()

    const result: types.ChatMessage = {
      author: 'bot',
      id: crypto.randomUUID(),
      conversationId: this.conversationId!,
      clientId: this.clientId!,
      conversationSignature: this.conversationSignature!,
      invocationId: `${parseInt(invocationId, 10) + 1}`,
      text: ''
    }

    return new Promise<types.ChatMessage>(
      async (resolve, reject) => {
        let received = 0
        const resetRespondTimer = () => {
          this.respondTimer && clearTimeout(this.respondTimer)
          this.respondTimer = setTimeout(() => {
            this.cleanup()
            reject(new Error(`Message waiting in WebSocket has timed out`))
          }, 8000)
        }

        this.ws = new WebSocket(
          env.BING_WS_URL || 'wss://sydney.bing.com/sydney/ChatHub', {
            perMessageDeflate: false,
            headers: {
              'accept-language': 'en-US,en;q=0.9',
              'cache-control': 'no-cache',
              pragma: 'no-cache'
            },
            handshakeTimeout: 5000
          })

        this.ws.on('error', (error) => {
          this.cleanup()
          reject(new Error(`WebSocket error: ${error.toString()}`))
        })
        this.ws.on('close', () => {
          this.cleanup()
        })

        this.ws.on('open', () => {
          resetRespondTimer()
          this.send({ protocol: 'json', version: 1 })
        })

        this.ws.on('message', (data) => {
          const objects = data.toString().split(terminalChar).filter(Boolean)
          if (objects.length === 0) return

          resetRespondTimer()
          const initialized = objects.length === 1 && objects[0] === '{}'
          const messages = objects.map((object) => {
            try {
              return JSON.parse(object)
            } catch (error) {
              return object
            }
          })

          if (received++ % 10 === 0) {
            this.keepalive()
          }

          if (initialized) {
            const traceId = crypto.randomBytes(16).toString('hex')

            const locationStr = location
              ? `lat:${location.lat};long:${location.lng};re=${location.re ||
              '1000m'};`
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
                  isStartOfSession: this.isStartOfSession,
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
                  conversationSignature: this.conversationSignature,
                  participant: { id: this.clientId },
                  conversationId: this.conversationId
                }
              ],
              invocationId,
              target: 'chat',
              type: 4
            }

            this.send(params)
            this.isStartOfSession = false
            this.resetConversationTimer()
          } else {
            for (const message of messages) {
              if (message.type === 1) {
                const update = message as types.ChatUpdate
                const msg = update.arguments[0].messages[0]

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

                  this.cleanup()
                  resolve(result)
                }
              } else if (message.type === 3) {
                this.cleanup()
                resolve(result)
              } else {
                // TODO: handle other message types
              }
            }
          }
        })
      }
    )
  }

  async initConversation (): Promise<types.ConversationResult> {
    const res = await fetch('https://www.bing.com/turing/conversation/create', {
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
        'x-ms-client-request-id': crypto.randomUUID(),
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
    })
    if (res.ok) {
      const result = await res.json()
      this.conversationExpired = false
      this.conversationId = result.conversationId
      this.clientId = result.clientId
      this.conversationSignature = result.conversationSignature
      this.isStartOfSession = true
      this.resetConversationTimer()
      return result
    } else {
      throw new Error(
        `unexpected HTTP error initConversation ${res.status}: ${res.statusText}`
      )
    }
  }

  resetConversationTimer () {
    this.conversationTimer && clearTimeout(this.conversationTimer)
    this.conversationTimer = setTimeout(() => {
      this.cleanup()
    }, 3600 * 24)
  }
}
