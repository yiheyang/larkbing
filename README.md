# LarkBing 🤖️

LarkBing is a bot application running New Bing's AI search engine for Lark (Feishu).

✅ Private and Group Chat Supported

✅ Private Session Context for Each User

✅ Progressive Message Output

✅ Beautified Result Message

## Quick Start

1. Clone the project and install dependencies.
```bash
git clone https://github.com/yiheyang/larkbing.git
yarn # or `npm install`
```
2. Configure your LarkBing.
```bash
cp .env.example .env

# Edit .env
```
3. Start your LarkBing and check your robot is running on the port (default: 3001).
```bash
yarn start # or `npm start`
```
4. Configure "Request URL" with `http(s)://domain:port/event` and add "Message received [v2.0] - im.message.receive_v1" event in "Event Subscription" - "Lark Developer App Panel".
5. Go to "Permissions & Scopes" and add all permissions that "im.message.receive_v1" requires and the following permissions.
- im:message
- im:message:send_as_bot
6. Turn on "Features/Bot" ability and configure "Message Card Request URL" with `http(s)://domain:port/card`.

## Robot Command
```text
/reset # Reset user's session context
```
## LICENCE
This project is under the protection of MIT license.
