# 服务器调试指南

本指南介绍如何调试和测试您的服务器。

## 启动服务器

### 开发模式启动
```bash
cd server
npm install
npm run dev
```

### 生产模式启动
```bash
cd server
npm install
npm start
```

### 调试模式启动
```bash
cd server
npm install
npm run debug
```

## 使用调试工具

### 安装依赖
```bash
npm install axios
```

### 运行完整调试
```bash
node debug-tool.js
```

### 指定端口运行调试
```bash
node debug-tool.js 3001
```

### 运行压力测试
```bash
node debug-tool.js --stress 10
```

## 调试工具功能

1. **健康检查**: 检查服务器是否正常运行
2. **端点测试**: 测试所有API端点是否正常工作
3. **数据创建**: 创建测试用户和书籍数据
4. **数据检索**: 获取创建的数据以验证数据库操作
5. **压力测试**: 并发请求测试服务器性能

## 手动测试 API

### 获取所有书籍
```bash
curl http://localhost:3000/api/books
```

### 搜索书籍
```bash
curl "http://localhost:3000/api/books?search=test"
```

### 创建新用户
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","contact_info":"test@example.com"}'
```

### 发布新书籍
```bash
curl -X POST http://localhost:3000/api/books \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Book","isbn":"1234567890123","price":29.99,"description":"A test book"}'
```

### 获取特定书籍
```bash
curl http://localhost:3000/api/books/1
```

## 数据库调试

数据库文件位置: `server/database.sqlite`

### 查看数据库内容
```bash
# 安装 sqlite3 命令行工具
npm install -g sqlite3

# 查看所有书籍
sqlite3 server/database.sqlite "SELECT * FROM books;"

# 查看所有用户
sqlite3 server/database.sqlite "SELECT * FROM users;"
```

## 日志和错误排查

服务器会在控制台输出以下信息：
- 启动成功消息
- 数据库连接状态
- 表创建状态
- 请求处理日志
- 错误信息

## 常见问题

### 端口被占用
如果默认端口3000被占用，可以通过环境变量更改：
```bash
PORT=3001 npm start
```

### 数据库连接失败
确保 `server/database.sqlite` 文件有适当的读写权限。

### CORS 问题
服务器已启用 CORS，允许所有来源访问。

## 调试技巧

1. 使用浏览器开发者工具的网络面板查看API请求
2. 在服务器控制台查看实时日志
3. 使用 Postman 或类似工具进行手动测试
4. 检查数据库文件确认数据持久化