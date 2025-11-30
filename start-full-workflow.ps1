# 完整工作流启动脚本（Windows PowerShell）

Write-Host "🚀 启动 my-agent-test 完整工作流测试环境" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green

# 检查 Docker 是否运行
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ Docker 未运行，请先启动 Docker Desktop" -ForegroundColor Red
    exit 1
}

# 1. 启动外部依赖
Write-Host "`n📦 步骤 1: 启动外部依赖（Kafka, MySQL, Redis）" -ForegroundColor Green
docker-compose up -d

# 等待服务就绪
Write-Host "⏳ 等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# 检查服务健康状态
Write-Host "`n🔍 检查服务健康状态" -ForegroundColor Green
docker-compose ps

# 2. 创建 Kafka Topics
Write-Host "`n📋 步骤 2: 创建 Kafka Topics" -ForegroundColor Green

$kafkaContainer = docker ps -qf "name=my-agent-kafka"

if (-not $kafkaContainer) {
    Write-Host "❌ Kafka 容器未找到" -ForegroundColor Red
    exit 1
}

# 创建 topics
$topics = @("workflow-tasks", "workflow-results", "agent-events")

foreach ($topic in $topics) {
    Write-Host "  创建 topic: $topic" -ForegroundColor Cyan
    docker exec $kafkaContainer kafka-topics `
        --create `
        --if-not-exists `
        --topic $topic `
        --bootstrap-server localhost:9092 `
        --partitions 3 `
        --replication-factor 1 2>$null
}

# 验证 topics
Write-Host "`n✅ 已创建的 Topics:" -ForegroundColor Green
docker exec $kafkaContainer kafka-topics `
    --list `
    --bootstrap-server localhost:9092

# 3. 显示启动指令
Write-Host "`n🖥️  步骤 3: 启动 my-agent-test 服务" -ForegroundColor Green
Write-Host "请在不同的终端（PowerShell）中执行以下命令：" -ForegroundColor Yellow
Write-Host ""

$commands = @(
    @{Name="A2A Server"; Command="npm run start:a2a-server"},
    @{Name="Workflow Consumer"; Command="npm run start:workflow-consumer"},
    @{Name="Planning Agent"; Command="npm run start:planning-agent"},
    @{Name="Art Agent"; Command="npm run start:art-agent"},
    @{Name="Music Agent"; Command="npm run start:music-agent"},
    @{Name="Tech Agent"; Command="npm run start:tech-agent"},
    @{Name="Test Agent"; Command="npm run start:test-agent"}
)

for ($i = 0; $i -lt $commands.Count; $i++) {
    $cmd = $commands[$i]
    Write-Host "终端 $($i + 1) - $($cmd.Name):" -ForegroundColor Green
    Write-Host "  $($cmd.Command)" -ForegroundColor White
    Write-Host ""
}

# 4. 显示测试命令
Write-Host "🧪 步骤 4: 测试工作流" -ForegroundColor Green
Write-Host "所有服务启动后，运行：" -ForegroundColor Yellow
Write-Host ""
Write-Host '  Invoke-RestMethod -Uri "http://localhost:8080/api/executions" `' -ForegroundColor White
Write-Host '    -Method POST `' -ForegroundColor White
Write-Host '    -ContentType "application/json" `' -ForegroundColor White
Write-Host '    -Body (Get-Content test-execution-request.json -Raw)' -ForegroundColor White
Write-Host ""

# 5. 显示停止命令
Write-Host "🛑 停止所有服务:" -ForegroundColor Green
Write-Host "  docker-compose down" -ForegroundColor White
Write-Host ""

# 6. 可选：自动在新窗口启动服务
Write-Host "💡 提示：是否要自动在新窗口启动所有服务？(Y/N)" -ForegroundColor Cyan
$answer = Read-Host

if ($answer -eq "Y" -or $answer -eq "y") {
    Write-Host "`n🚀 正在启动所有服务..." -ForegroundColor Green

    foreach ($cmd in $commands) {
        $windowTitle = "my-agent-test - $($cmd.Name)"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd.Command -WindowStyle Normal -WorkingDirectory $PWD
        Write-Host "  ✅ 已启动: $($cmd.Name)" -ForegroundColor Green
        Start-Sleep -Milliseconds 500
    }

    Write-Host "`n✅ 所有服务已在新窗口中启动" -ForegroundColor Green
    Write-Host "请检查各个窗口确认服务正常运行" -ForegroundColor Yellow
} else {
    Write-Host "`n请手动在新终端中启动服务" -ForegroundColor Yellow
}

Write-Host "`n================================================" -ForegroundColor Green
Write-Host "✅ 外部依赖已启动" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
