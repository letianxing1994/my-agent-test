# 启动所有 Agent 服务
Write-Host "正在启动 my-agent-test 系统..." -ForegroundColor Green

# 确保在正确的目录
Set-Location $PSScriptRoot

# 检查 node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "正在安装依赖..." -ForegroundColor Yellow
    npm install
}

# 检查 .env 文件
if (-not (Test-Path ".env")) {
    Write-Host "警告: .env 文件不存在！请从 env.example 复制并配置" -ForegroundColor Red
    Write-Host "执行: cp env.example .env" -ForegroundColor Yellow
    exit 1
}

# 检查构建
if (-not (Test-Path "dist")) {
    Write-Host "正在构建项目..." -ForegroundColor Yellow
    npm run build
}

Write-Host "`n启动顺序:" -ForegroundColor Cyan
Write-Host "1. A2A 服务器 (端口 3030)" -ForegroundColor White
Write-Host "2. Planning Agent" -ForegroundColor White
Write-Host "3. Art Agent" -ForegroundColor White
Write-Host "4. Music Agent" -ForegroundColor White
Write-Host "5. Tech Agent" -ForegroundColor White
Write-Host "6. Test Agent" -ForegroundColor White

Write-Host "`n正在启动服务..." -ForegroundColor Green

# 启动 A2A 服务器（必须先启动）
Write-Host "启动 A2A 服务器..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run start:a2a-server"

# 等待 A2A 服务器启动
Start-Sleep -Seconds 3

# 启动各个 Agent
Write-Host "启动 Planning Agent..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run start:planning-agent"
Start-Sleep -Seconds 1

Write-Host "启动 Art Agent..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run start:art-agent"
Start-Sleep -Seconds 1

Write-Host "启动 Music Agent..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run start:music-agent"
Start-Sleep -Seconds 1

Write-Host "启动 Tech Agent..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run start:tech-agent"
Start-Sleep -Seconds 1

Write-Host "启动 Test Agent..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run start:test-agent"

Write-Host "`n所有服务已启动！" -ForegroundColor Green
Write-Host "`n访问 A2A 服务器: http://localhost:3030" -ForegroundColor Cyan
Write-Host "WebSocket 连接: ws://localhost:3030" -ForegroundColor Cyan
Write-Host "`n按 Ctrl+C 可以停止此脚本（但不会停止已启动的服务）" -ForegroundColor Gray
Write-Host "要停止所有服务，请关闭各个 PowerShell 窗口" -ForegroundColor Gray

# 保持脚本运行
Read-Host "`n按 Enter 键退出..."
