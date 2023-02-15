import crypto from 'crypto'
import WebSocket from 'ws'
import dotenv from 'dotenv'
import * as types from './types'
import { throttle } from 'lodash'

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

  initializingConversation = false
  initConversationCallback: [any, any][] = []
  conversationExpired = true
  conversationId?: string
  clientId?: string
  conversationSignature?: string
  isStartOfSession = true

  conversationTimer?: NodeJS.Timeout
  respondTimer?: NodeJS.Timeout

  send (content: any) {
    this.ws?.send(JSON.stringify(content) + terminalChar)
  }

  keepalive () {
    this.send({ type: 6 })
  }

  cleanup () {
    this.conversationTimer && clearTimeout(this.conversationTimer)
    this.respondTimer && clearTimeout(this.respondTimer)
    this.ws?.terminate()
    this.ws = undefined
    this.initializingConversation = false
    this.initConversationCallback = []
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
  ) {
    const {
      invocationId = '1',
      onProgress,
      locale = 'zh-CN',
      market = 'en-US',
      region = 'US',
      location
    } = opts

    const throttledOnProgress = onProgress && throttle(onProgress, 500)

    if (this.conversationExpired) await this.initConversation()

    return new Promise<types.ChatMessageFull[]>(
      async (resolve, reject) => {
        let received = 0
        let updateMessages: types.ChatMessagePartial[] = []

        const resetRespondTimer = () => {
          this.respondTimer && clearTimeout(this.respondTimer)
          this.respondTimer = setTimeout(() => {
            this.cleanup()
            reject(new Error(`Message waiting in WebSocket has timed out`))
          }, 8000)
        }

        const ws = new WebSocket(
          env.BING_WS_URL || 'wss://sydney.bing.com/sydney/ChatHub', {
            perMessageDeflate: false,
            headers: {
              'accept-language': 'en-US,en;q=0.9',
              'cache-control': 'no-cache',
              pragma: 'no-cache'
            },
            handshakeTimeout: 5000
          })

        ws.on('error', (error) => {
          this.cleanup()
          reject(new Error(`WebSocket error: ${error.toString()}`))
        })
        ws.on('close', () => {
          this.cleanup()
        })

        ws.on('open', () => {
          resetRespondTimer()
          this.send({ protocol: 'json', version: 1 })
        })

        ws.on('message', (data) => {
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

            const locationStr = location &&
              `lat:${location.lat};long:${location.lng};re=${location.re ||
              '1000m'};`

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

                const targetIndex = updateMessages.findIndex(
                  (item) => item.messageId === msg.messageId)

                if (targetIndex === -1) {
                  updateMessages.push(msg)
                } else {
                  updateMessages[targetIndex] = msg
                }

                throttledOnProgress?.(updateMessages)
              } else if (message.type === 2) {
                const response = message as types.ChatUpdateCompleteResponse
                this.cleanup()
                resolve(response.item.messages)
              } else {
                // TODO: handle other message types
              }
            }
          }
        })
      }
    )
  }

  initConversation () {
    return new Promise(async (resolve, reject) => {
      this.initConversationCallback.push([resolve, reject])

      if (this.initializingConversation) return
      this.initializingConversation = true
      const res = await fetch('https://www.bing.com/turing/conversation/create',
        {
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
        this.initConversationCallback.forEach(([_res]) => _res())
      } else {
        this.initConversationCallback.forEach(([, _rej]) => _rej(new Error(
          `unexpected HTTP error initConversation ${res.status}: ${res.statusText}`
        )))
      }
      this.initializingConversation = false
      this.initConversationCallback = []
    })
  }

  resetConversationTimer () {
    this.conversationTimer && clearTimeout(this.conversationTimer)
    this.conversationTimer = setTimeout(() => {
      this.cleanup()
    }, 3600 * 24)
  }
}
