#!/bin/bash
# 测试 Planning Agent 预览功能

curl -X POST http://localhost:8080/api/executions/preview \
  -H "Content-Type: application/json" \
  -d '{
    "stageId": "planning",
    "cloudProvider": "aliyun",
    "userInput": {
      "projectName": "魔法世界冒险",
      "gameGenre": {
        "primary": "rpg",
        "subGenre": "arpg"
      },
      "dimension": "3d",
      "artStyle": "anime",
      "gameMode": "singleplayer",
      "additionalRequirements": "需要魔法系统和装备系统"
    },
    "stageConfig": {
      "stageId": "planning",
      "agentId": "planning-agent",
      "model": "gpt-4",
      "mode": "llm+kb",
      "planningFocus": {
        "narrative": true,
        "numeric": true,
        "levelDesign": false,
        "systemDesign": {
          "growth": true,
          "equipment": true,
          "social": false,
          "combat": true
        }
      }
    }
  }'
