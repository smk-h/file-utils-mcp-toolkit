# 我的初步想法

根据docs/remote-file-mcp.md中的方案，我想要实现file-utils-mcp-toolkit这个mcp server，要支持bash、read、edit、grep、glob、write工具，集成@smai-kit/file-utils这个库，将对应的工具封装成mcp工具。

要求：
1. 使用 `npm i @smai-kit/file-utils@latest`安装库，它会自动更新package.json
2. @smai-kit/file-utils这个依赖随包发布的有每个工具的usage文档，查阅文档后掌握用法再开始开发，另外会包含mcp-adapter-guide.md，它是mcp适配的一些建议，可以参考。
3. mcp协议不要使用已经删除或者被弃用的接口
4. 工具的返回值不一定可以直接作为
