import { BingChat } from './lib'

async function main() {
  const chat = new BingChat()
  const prompt = '帮我搜索一下稳定币的政策'
  let res = await chat.sendMessage(prompt)
  console.log(res)
}
main().then()
