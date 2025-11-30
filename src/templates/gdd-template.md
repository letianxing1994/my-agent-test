# 游戏设计文档 (Game Design Document)

**项目名称**: {{projectName}}
**游戏类型**: {{gameType}}
**目标平台**: {{targetPlatforms}}
**创建日期**: {{createdAt}}
**最后更新**: {{updatedAt}}

---

## 1. 核心概念 (Core Concept)

{{coreConcept}}

### 1.1 游戏类型
- **主要类型**: {{primaryGenre}}
- **次要类型**: {{subGenre}}
- **混合类型**: {{hybridGenres}}

### 1.2 美术风格
- **维度**: {{dimension}}
- **美术风格**: {{artStyle}}
- **游戏模式**: {{gameMode}}

---

## 2. 核心玩法机制 (Gameplay Mechanics)

{{#each gameplayMechanics}}
### 2.{{@index}}.1 {{name}}

**描述**: {{description}}

**实现细节**:
{{implementationDetails}}

---
{{/each}}

## 3. 角色设计 (Character Designs)

{{#if characterDesigns}}
{{#each characterDesigns}}
### 3.{{@index}}.1 {{name}} ({{type}})

{{description}}

**属性**:
{{#each attributes}}
- **{{@key}}**: {{this}}
{{/each}}

---
{{/each}}
{{else}}
*待设计*
{{/if}}

## 4. 关卡设计 (Level Designs)

{{#if levelDesigns}}
{{#each levelDesigns}}
### 4.{{@index}}.1 {{name}}

{{description}}

**关卡目标**:
{{#each objectives}}
- {{this}}
{{/each}}

---
{{/each}}
{{else}}
*待设计*
{{/if}}

## 5. 用户界面设计 (UI Design)

{{#if uiDesign}}
### 5.1 界面列表
{{#each uiDesign.screens}}
- {{this}}
{{/each}}

### 5.2 操作控制
| 操作 | 按键/控制 |
|------|-----------|
{{#each uiDesign.controls}}
| {{@key}} | {{this}} |
{{/each}}
{{else}}
*待设计*
{{/if}}

---

## 6. 美术需求 (Art Requirements)

| 类型 | 描述 | 数量 | 优先级 |
|------|------|------|--------|
{{#each artRequirements}}
| {{type}} | {{description}} | {{quantity}} | {{priority}} |
{{/each}}

---

## 7. 音频需求 (Audio Requirements)

| 类型 | 描述 | 数量 | 优先级 |
|------|------|------|--------|
{{#each audioRequirements}}
| {{type}} | {{description}} | {{quantity}} | {{priority}} |
{{/each}}

---

## 8. 技术需求 (Technical Requirements)

**游戏引擎**: {{technicalRequirements.engine}}
**目标平台**: {{#each technicalRequirements.targetPlatforms}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
**性能要求**: {{technicalRequirements.performanceRequirements}}

---

## 9. 故事节拍 (Story Beats)

{{#if storyBeats}}
{{#each storyBeats}}
### Act {{@index}}: {{act}}

{{summary}}

{{/each}}
{{else}}
*本游戏不包含复杂叙事*
{{/if}}

---

## 10. 数值设计 (Numeric Models)

{{#if numericModels}}
{{#each numericModels}}
### 10.{{@index}}.1 {{system}}

**关键指标**: {{#each metrics}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}

{{#if notes}}
**备注**: {{notes}}
{{/if}}

{{/each}}
{{else}}
*待设计*
{{/if}}

---

## 11. 系统设计 (System Designs)

{{#if systemDesigns}}
{{#each systemDesigns}}
### 11.{{@index}}.1 {{name}}

{{description}}

{{#if components}}
**核心组件**:
{{#each components}}
- {{this}}
{{/each}}
{{/if}}

---
{{/each}}
{{else}}
*待设计*
{{/if}}

---

## 附录 (Appendix)

### 文档元数据
- **项目ID**: {{projectId}}
- **文档版本**: 1.0
- **生成方式**: Planning Agent (AI-assisted)
- **最后更新**: {{updatedAt}}

---

*本文档由 my-agent-test Planning Agent 生成*
