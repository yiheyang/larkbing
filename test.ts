import { BingChat } from './lib'

async function main () {
  const chat = new BingChat()
  let prompt = '帮我搜索一下稳定币的政策'
  console.log(prompt)
  let res = await chat.sendMessage(prompt, {
    onProgress: console.log
  })
  console.log(res)

  // prompt = '目前有那些国家禁止使用稳定币？'
  // console.log(prompt)
  // res = await chat.sendMessage(prompt)
  // console.log(res.text)
  //
  // prompt = '总结一下刚刚我们的对话？'
  // console.log(prompt)
  // res = await chat.sendMessage(prompt)
  // console.log(res.text)
}

main().then()
