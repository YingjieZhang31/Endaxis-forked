<script setup>
import { ref, provide, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import ActionItem from './ActionItem.vue'
import ActionConnector from './ActionConnector.vue'
import GaugeOverlay from './GaugeOverlay.vue'

const store = useTimelineStore()

// ===================================================================================
// 1. 初始化与依赖注入 (Init & Injection)
// ===================================================================================

// 提供给子组件 (ActionItem/Connector) 使用的全局缩放比例
const TIME_BLOCK_WIDTH = computed(() => store.timeBlockWidth)
provide('TIME_BLOCK_WIDTH', TIME_BLOCK_WIDTH)

// DOM 引用
const tracksContentRef = ref(null)
const timeRulerWrapperRef = ref(null)
const tracksHeaderRef = ref(null)

// 状态变量
const svgRenderKey = ref(0)
const scrollbarHeight = ref(0)
const showCursorGuide = ref(true) // 辅助线开关
const cursorX = ref(0)            // 辅助线位置
const isCursorVisible = ref(false)

// 拖拽内部状态机
const isMouseDown = ref(false)
const isDragStarted = ref(false)
const movingActionId = ref(null)
const movingTrackId = ref(null)
const initialMouseX = ref(0)
const initialMouseY = ref(0)
const dragThreshold = 5
const wasSelectedOnPress = ref(false)

let resizeObserver = null

// ===================================================================================
// 2. 计算属性 (Computed Properties)
// ===================================================================================

// 生成时间轴标尺的刻度数组 [1, 2, ..., TOTAL_DURATION]
const timeBlocks = computed(() => {
  return Array.from({ length: store.TOTAL_DURATION }, (_, i) => i + 1)
})

// 将干员列表按星级分组，用于下拉选择框
const groupedCharacters = computed(() => {
  const groups = {}
  store.characterRoster.forEach(char => {
    const rarity = char.rarity || 0
    if (!groups[rarity]) groups[rarity] = []
    groups[rarity].push(char)
  })
  // 按星级从高到低排序
  return Object.keys(groups).sort((a, b) => b - a).map(rarity => ({
    label: rarity > 0 ? `${rarity} ★` : '未知星级',
    options: groups[rarity]
  }))
})

// ===================================================================================
// 3. 核心功能方法 (Core Methods)
// ===================================================================================

/**
 * 强制重绘 SVG 层
 * 用于在拖拽、缩放、滚动结束时更新连线位置
 */
function forceSvgUpdate() {
  svgRenderKey.value++
}

/**
 * 计算滚动条高度补偿
 * 目的：确保左侧头像栏和右侧轨道在高度上完美对齐 (抵消右侧横向滚动条的高度)
 */
function updateScrollbarHeight() {
  if (tracksContentRef.value) {
    const el = tracksContentRef.value
    const height = el.offsetHeight - el.clientHeight
    scrollbarHeight.value = height > 0 ? height : 0
  }
}

/**
 * 切换光标辅助线显示状态
 */
function toggleCursorGuide() {
  showCursorGuide.value = !showCursorGuide.value
}

/**
 * 根据鼠标 X 坐标反算时间点
 * @param {MouseEvent} evt
 * @returns {Number} 时间 (秒)，保留一位小数
 */
function calculateTimeFromEvent(evt) {
  const trackRect = tracksContentRef.value.getBoundingClientRect()
  const scrollLeft = tracksContentRef.value.scrollLeft
  const mouseX = evt.clientX
  const activeOffset = store.globalDragOffset || 0

  // 鼠标在内容区的相对位置
  const mouseXInTrack = (mouseX - activeOffset) - trackRect.left + scrollLeft

  // 转换为时间块索引 (每 0.5s 一个吸附格)
  const fractionalBlockIndex = mouseXInTrack / TIME_BLOCK_WIDTH.value
  let startTime = Math.round(fractionalBlockIndex * 2) / 2

  if (startTime < 0) startTime = 0
  return startTime
}

// ===================================================================================
// 4. 滚动同步 (Scroll Sync)
// ===================================================================================

/**
 * 水平滚动同步：内容区 -> 顶部标尺
 */
function syncRulerScroll() {
  if (timeRulerWrapperRef.value && tracksContentRef.value) {
    const left = tracksContentRef.value.scrollLeft
    timeRulerWrapperRef.value.scrollLeft = left
    store.setScrollLeft(left) // 同步到 Store 供 SpMonitor 使用
  }
  forceSvgUpdate()
}

/**
 * 垂直滚动同步：内容区 -> 左侧头像栏
 */
function syncVerticalScroll() {
  if (tracksHeaderRef.value && tracksContentRef.value) {
    tracksHeaderRef.value.scrollTop = tracksContentRef.value.scrollTop
  }
}

// ===================================================================================
// 5. 交互事件处理 (Event Handlers)
// ===================================================================================

// 辅助线跟随逻辑
function onGridMouseMove(evt) {
  if (!tracksContentRef.value) return
  const rect = tracksContentRef.value.getBoundingClientRect()
  const scrollLeft = tracksContentRef.value.scrollLeft
  // 计算光标在滚动容器内的绝对 X 坐标
  cursorX.value = (evt.clientX - rect.left) + scrollLeft
  isCursorVisible.value = true
}

function onGridMouseLeave() {
  isCursorVisible.value = false
}

// 轨道内拖拽 - 按下
function onActionMouseDown(evt, track, action) {
  evt.stopPropagation()
  // 仅左键响应
  if (evt.button !== 0) return

  wasSelectedOnPress.value = (store.selectedActionId === action.instanceId)

  // 如果不是为了取消选中，则选中当前动作
  if (!store.isLinking && !wasSelectedOnPress.value) {
    store.selectAction(action.instanceId)
  }

  // 初始化拖拽状态
  isMouseDown.value = true
  isDragStarted.value = false
  movingActionId.value = action.instanceId
  movingTrackId.value = track.id
  initialMouseX.value = evt.clientX
  initialMouseY.value = evt.clientY

  // 计算点击点相对于动作块左边缘的偏移，保证拖拽时不跳变
  const rect = evt.currentTarget.getBoundingClientRect()
  store.setDragOffset(evt.clientX - rect.left)

  // 绑定全局事件，防止拖出窗口丢失焦点
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup', onWindowMouseUp)
  window.addEventListener('blur', onWindowMouseUp)
}

// 轨道内拖拽 - 移动
function onWindowMouseMove(evt) {
  if (!isMouseDown.value) return
  // 如果鼠标松开了但事件没触发，强制结束
  if (evt.buttons === 0) { onWindowMouseUp(evt); return }

  // 忽略在输入框等元素上的拖拽
  const target = evt.target
  const isFormElement = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  const isInSidebar = target && (target.closest('.properties-sidebar') || target.closest('.action-library'))
  if (isFormElement || isInSidebar) { onWindowMouseUp(evt); return }

  // 拖拽阈值判定 (防止点击微抖动被误判为拖拽)
  if (!isDragStarted.value) {
    const dist = Math.sqrt(Math.pow(evt.clientX - initialMouseX.value, 2) + Math.pow(evt.clientY - initialMouseY.value, 2))
    if (dist > dragThreshold) { isDragStarted.value = true } else { return }
  }

  // 执行拖拽位置更新
  const track = store.tracks.find(t => t.id === movingTrackId.value)
  const action = track?.actions.find(a => a.instanceId === movingActionId.value)
  if (action) {
    const newTime = calculateTimeFromEvent(evt)
    if (isDragStarted.value && newTime !== action.startTime) {
      action.startTime = newTime
      track.actions.sort((a, b) => a.startTime - b.startTime) // 保持时间顺序
      nextTick(() => forceSvgUpdate()) // 实时更新连线
    }
  }
}

// 轨道内拖拽 - 抬起
function onWindowMouseUp(evt) {
  const _wasDragging = isDragStarted.value
  try {
    // 如果仅仅是点击（未触发拖拽），处理连线或取消连线逻辑
    if (!isDragStarted.value && movingActionId.value) {
      if (store.isLinking) { store.confirmLinking(movingActionId.value) }
      else { if (store.cancelLinking) store.cancelLinking() }
    }
  } catch (error) {
    console.error("MouseUp Error:", error)
  } finally {
    // 重置状态
    isMouseDown.value = false
    isDragStarted.value = false
    movingActionId.value = null
    movingTrackId.value = null
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
    window.removeEventListener('blur', onWindowMouseUp)
  }
  // 如果发生过拖拽，阻止后续的 click 事件 (防止触发 selectAction)
  if (_wasDragging) { window.addEventListener('click', captureClick, { capture: true, once: true }) }
}

// 阻止冒泡的辅助函数
function captureClick(e) { e.stopPropagation(); e.preventDefault() }

// 处理从库中拖入新技能的 drop 事件
function onTrackDrop(track, evt) {
  const skill = store.draggingSkillData
  if (!skill) return
  // 只能放置在当前高亮的轨道
  if (store.activeTrackId !== track.id) return

  const startTime = calculateTimeFromEvent(evt)
  store.addSkillToTrack(track.id, skill, startTime)
  nextTick(() => forceSvgUpdate())
}

function onTrackDragOver(evt) {
  evt.preventDefault()
  evt.dataTransfer.dropEffect = 'copy'
}

function onActionClick(action) {
  if (isDragStarted.value) return
  if (wasSelectedOnPress.value && store.selectedActionId === action.instanceId) { store.selectAction(action.instanceId) }
}

function onBackgroundClick(event) {
  // 点击空白处取消选中
  if (event.target === tracksContentRef.value || event.target.classList.contains('track-row') || event.target.classList.contains('time-block')) {
    store.cancelLinking()
    store.selectTrack(null)
  }
}

function handleKeyDown(event) {
  if (!store.selectedActionId) return
  if (event.key === 'Delete') { store.removeAction(store.selectedActionId); event.preventDefault() }
}

// ===================================================================================
// 6. 生命周期 & 监听器 (Lifecycle & Watchers)
// ===================================================================================

// 监听缩放变化：重绘连线，重新计算滚动条高度
watch(() => store.timeBlockWidth, () => {
  nextTick(() => { forceSvgUpdate(); updateScrollbarHeight() })
})

// 监听数据变化：重绘连线
watch(() => [store.tracks, store.connections], () => {
  setTimeout(() => { forceSvgUpdate() }, 50)
}, {deep: false})

onMounted(() => {
  if (tracksContentRef.value) {
    tracksContentRef.value.addEventListener('scroll', syncRulerScroll)
    tracksContentRef.value.addEventListener('scroll', syncVerticalScroll)

    // 监听容器尺寸变化 (如窗口缩放)
    resizeObserver = new ResizeObserver(() => { forceSvgUpdate(); updateScrollbarHeight() })
    resizeObserver.observe(tracksContentRef.value)

    updateScrollbarHeight()
  }
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  if (tracksContentRef.value) {
    tracksContentRef.value.removeEventListener('scroll', syncRulerScroll)
    tracksContentRef.value.removeEventListener('scroll', syncVerticalScroll)
    if (resizeObserver) resizeObserver.disconnect()
  }
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
})
</script>

<template>
  <div class="timeline-grid-layout">
    <div class="corner-placeholder">
      <button
          class="guide-toggle-btn"
          :class="{ 'is-active': showCursorGuide }"
          @click="toggleCursorGuide"
          title="切换光标辅助线"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="6" x2="12" y2="18"></line>
          <line x1="6" y1="12" x2="18" y2="12"></line>
        </svg>
      </button>
    </div>

    <div class="time-ruler-wrapper" ref="timeRulerWrapperRef" @click="store.selectTrack(null)">
      <div class="time-ruler-track">
        <div v-for="block in timeBlocks" :key="block" class="ruler-tick" :style="{ width: `${TIME_BLOCK_WIDTH}px` }"
             :class="{ 'major-tick': (block % 5 === 0) }">
          <span v-if="block % 5 === 0" class="tick-label">{{ block }}s</span>
        </div>
      </div>
    </div>

    <div class="tracks-header-sticky" ref="tracksHeaderRef" @click="store.selectTrack(null)"
         :style="{ paddingBottom: `${20 + scrollbarHeight}px` }">
      <div v-for="(track, index) in store.teamTracksInfo" :key="index" class="track-info"
           @click.stop="store.selectTrack(track.id)"
           :class="{ 'is-active': track.id && track.id === store.activeTrackId }">
        <img v-if="track.id" :src="track.avatar" class="avatar-image" :alt="track.name"/>
        <div v-else class="avatar-placeholder"></div>
        <el-select :model-value="track.id" @change="(newId) => store.changeTrackOperator(index, track.id, newId)"
                   placeholder="选择干员" class="character-select" @click.stop>
          <el-option-group v-for="group in groupedCharacters" :key="group.label" :label="group.label">
            <el-option v-for="character in group.options" :key="character.id" :label="character.name" :value="character.id"/>
          </el-option-group>
        </el-select>
      </div>
    </div>

    <div class="tracks-content-scroller"
         ref="tracksContentRef"
         @click="onBackgroundClick"
         @mousemove="onGridMouseMove"
         @mouseleave="onGridMouseLeave"
    >
      <div class="cursor-guide" :style="{ left: `${cursorX}px` }" v-show="isCursorVisible && showCursorGuide"></div>

      <div class="tracks-content">
        <svg class="connections-svg">
          <template v-if="tracksContentRef">
            <ActionConnector v-for="conn in store.connections" :key="conn.id" :connection="conn"
                             :container-ref="tracksContentRef" :render-key="svgRenderKey"/>
          </template>
        </svg>

        <div v-for="(track, index) in store.tracks" :key="index" class="track-row"
             :id="`track-row-${index}`"
             :class="{ 'is-active-drop': track.id === store.activeTrackId }"
             @dragover="onTrackDragOver"
             @drop="onTrackDrop(track, $event)">

          <div class="track-lane">
            <div v-for="block in timeBlocks" :key="block" class="time-block" :style="{ width: `${TIME_BLOCK_WIDTH}px` }"></div>
            <GaugeOverlay v-if="track.id" :track-id="track.id"/>
            <div class="actions-container">
              <ActionItem v-for="action in track.actions" :key="action.instanceId" :action="action"
                          @mousedown="onActionMouseDown($event, track, action)"
                          @click.stop="onActionClick(action)"
                          :class="{ 'is-moving': isDragStarted && movingActionId === action.instanceId }"/>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* === 核心 Grid 布局 === */
.timeline-grid-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  grid-template-rows: 40px 1fr;
  width: 100%; height: 100%; overflow: hidden;
}

/* 左上角功能区 */
.corner-placeholder {
  grid-column: 1 / 2; grid-row: 1 / 2;
  background-color: #3a3a3a;
  border-bottom: 1px solid #444; border-right: 1px solid #444;
  display: flex; align-items: center; justify-content: center;
}

.guide-toggle-btn {
  background: none; border: 1px solid #555; color: #777;
  border-radius: 4px; cursor: pointer; padding: 4px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.guide-toggle-btn:hover { border-color: #888; color: #ccc; }
.guide-toggle-btn.is-active { border-color: #ffd700; color: #ffd700; background: rgba(255, 215, 0, 0.1); }

/* === 顶部时间尺 === */
.time-ruler-wrapper {
  grid-column: 2 / 3; grid-row: 1 / 2;
  background-color: #2b2b2b; border-bottom: 1px solid #444;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  overflow: hidden; z-index: 6; user-select: none;
}
.time-ruler-track { display: flex; flex-direction: row; width: fit-content; height: 100%; align-items: flex-end; }
.ruler-tick { height: 100%; box-sizing: border-box; flex-shrink: 0; position: relative; border-right: none; }
.ruler-tick::after { content: ''; position: absolute; bottom: 0; right: 0; width: 1px; background-color: #555; height: 6px; transition: all 0.2s; }
.ruler-tick.major-tick::after { height: 14px; background-color: #aaa; width: 1px; }
.ruler-tick:hover::after { background-color: #ffd700; height: 100%; opacity: 0.5; }
.tick-label { position: absolute; right: 0; transform: translateX(50%); top: 2px; font-size: 10px; color: #777; font-family: 'Roboto Mono', monospace; font-weight: 500; pointer-events: none; white-space: nowrap; }
.ruler-tick.major-tick .tick-label { color: #e0e0e0; font-weight: bold; top: 0px; font-size: 11px; text-shadow: 1px 1px 2px rgba(0,0,0,0.8); }

/* === 左侧头像栏 === */
.tracks-header-sticky {
  grid-column: 1 / 2; grid-row: 2 / 3; width: 180px;
  background-color: #3a3a3a; display: flex; flex-direction: column;
  z-index: 6; border-right: 1px solid #444;
  box-sizing: border-box; padding: 20px 0;
  height: 100%; overflow-x: hidden;
}

/* === 右侧内容容器 === */
.tracks-content-scroller {
  grid-column: 2 / 3; grid-row: 2 / 3;
  width: 100%; height: 100%; overflow: auto; position: relative;
  background-color: #18181c; /* 纯净深色背景 */
}

.tracks-content {
  position: relative; width: fit-content; min-width: 100%;
  display: flex; flex-direction: column;
  box-sizing: border-box; padding: 20px 0;
  height: 100%; min-height: 100%;
}

/* 光标辅助线 */
.cursor-guide {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background-color: rgba(255, 215, 0, 0.8);
  pointer-events: none; z-index: 5;
  box-shadow: 0 0 6px #ffd700;
}

/* 列表项样式 */
.track-info {
  flex: 1; min-height: 60px; display: flex; align-items: center;
  background-color: #3a3a3a; flex-shrink: 0; cursor: pointer;
  transition: background-color 0.2s; box-sizing: border-box; padding-left: 8px;
}
.track-info.is-active { background-color: #4a5a6a; border-right: 3px solid #ffd700; }
.avatar-image { width: 44px; height: 44px; border-radius: 50%; background-color: #555; margin-right: 8px; flex-shrink: 0; object-fit: cover; }
.avatar-placeholder { width: 44px; height: 44px; border-radius: 50%; background-color: #444; border: 2px dashed #666; margin-right: 8px; flex-shrink: 0; box-sizing: border-box; }
.character-select { flex-grow: 1; width: 0; }
.character-select :deep(.el-input__wrapper) { background-color: transparent !important; box-shadow: none !important; padding: 0; }
.character-select :deep(.el-input__inner) { color: #f0f0f0; font-size: 16px; font-weight: bold; }
.character-select :deep(.el-input) { --el-input-border-color: transparent; --el-input-hover-border-color: transparent; --el-input-focus-border-color: transparent; }
.character-select :deep(.el-select__caret) { display: none; }
.track-info:hover .character-select :deep(.el-select__caret) { display: inline-block; }

/* 轨道行 */
.track-row {
  position: relative; flex: 1; min-height: 60px;
  display: flex; flex-direction: column; justify-content: center;
  background-color: transparent;
  transition: background-color 0.2s; overflow: visible; box-sizing: border-box;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.track-lane {
  position: relative; height: 50px; width: 100%;
  display: flex; flex-direction: row;
  background-color: rgba(255, 255, 255, 0.02);
  border-top: 2px solid transparent; border-bottom: 2px solid transparent;
}

.track-row.is-active-drop .track-lane {
  border-top: 2px dashed #c0c0c0; border-bottom: 2px dashed #c0c0c0; z-index: 20;
}

.time-block {
  height: 100%;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  box-sizing: border-box; flex-shrink: 0;
}

.actions-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; min-width: 100%; z-index: 10; pointer-events: auto; display: block; }
.connections-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 25; pointer-events: none; overflow: visible; }
</style>