<script setup>
import { computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

const props = defineProps({
  connection: { type: Object, required: true },
  containerRef: { type: Object, required: false },
  renderKey: { type: Number }
})

const store = useTimelineStore()
const gradientId = computed(() => `grad-${props.connection.id}`)

// === 1. 颜色解析逻辑 ===
/**
 * 解析颜色
 * @param {Object} info - 由 getActionPositionInfo 返回的对象 { action, trackIndex }
 * @param {Number|null} effectIndex - 图标索引
 */
const resolveColor = (info, effectIndex) => {
  if (!info || !info.action) return store.getColor('default')

  const { action, trackIndex } = info

  // A. 优先：小图标属性
  if (effectIndex !== undefined && effectIndex !== null) {
    const effect = action.physicalAnomaly?.[effectIndex]
    if (effect) return store.getColor(effect.type)
    return store.getColor('default')
  }

  // B. 特殊动作类型固定色
  if (action.type === 'link') return store.getColor('link')
  if (action.type === 'execution') return store.getColor('execution')
  if (action.type === 'attack') return store.getColor('physical') // 重击强制物理

  // C. 优先读取动作自带属性
  if (action.element) {
    return store.getColor(action.element)
  }

  // D. 回退查找干员属性
  // 如果动作本身没记录属性，就去查这条轨道是谁的
  if (trackIndex !== undefined && trackIndex !== null) {
    const track = store.tracks[trackIndex]
    if (track && track.id) {
      // 获取该干员的属性色 (如 Blaze -> Red)
      return store.getCharacterElementColor(track.id)
    }
  }

  // E. 最后兜底 (战技默认白，终结技默认青)
  return store.getColor(action.type)
}

// === 2. 坐标计算 ===
const getDomPosition = (elementId, containerEl, isSource) => {
  const el = document.getElementById(elementId)
  if (!el || !containerEl) return null
  const rect = el.getBoundingClientRect()
  const containerRect = containerEl.getBoundingClientRect()
  const offsetX = isSource ? rect.right : rect.left
  const x = (offsetX - containerRect.left) + containerEl.scrollLeft
  const y = (rect.top - containerRect.top) + (rect.height / 2) + containerEl.scrollTop
  return { x, y }
}

const getTrackCenterY = (trackIndex) => {
  const rowEl = document.getElementById(`track-row-${trackIndex}`)
  if (rowEl) return rowEl.offsetTop + (rowEl.offsetHeight / 2)
  return 20 + trackIndex * 80
}

const calculatePoint = (nodeId, effectIndex, isSource) => {
  const info = store.getActionPositionInfo(nodeId)
  if (!info) return null

  if (effectIndex !== undefined && effectIndex !== null) {
    const domId = `anomaly-${nodeId}-${effectIndex}`
    const pos = getDomPosition(domId, props.containerRef, isSource)
    if (pos) return { x: pos.x, y: pos.y }
  }

  const x = isSource
      ? (info.action.startTime + info.action.duration) * store.timeBlockWidth
      : info.action.startTime * store.timeBlockWidth

  let y = getTrackCenterY(info.trackIndex)

  if (!isSource && effectIndex == null) {
    const incoming = store.getIncomingConnections(nodeId)
    const generalIncoming = incoming.filter(c => c.toEffectIndex == null)
    generalIncoming.sort((a, b) => a.id.localeCompare(b.id))
    const myIndex = generalIncoming.findIndex(c => c.id === props.connection.id)
    if (myIndex !== -1 && generalIncoming.length > 1) {
      const spread = 6
      y += (myIndex - (generalIncoming.length - 1) / 2) * spread
    }
  }

  return { x, y }
}

// === 3. 路径生成 ===
const pathInfo = computed(() => {
  const _trigger = props.renderKey
  const conn = props.connection

  // 获取完整的 info 对象 (包含 trackIndex)
  const fromInfo = store.getActionPositionInfo(conn.from)
  const toInfo = store.getActionPositionInfo(conn.to)

  if (!fromInfo || !toInfo) return null

  // 计算坐标
  const start = calculatePoint(conn.from, conn.fromEffectIndex, true)
  const end = calculatePoint(conn.to, conn.toEffectIndex, false)

  if (!start || !end) return null

  // 解析颜色 (传入完整的 info 对象)
  const colorStart = resolveColor(fromInfo, conn.fromEffectIndex)
  const colorEnd = resolveColor(toInfo, conn.toEffectIndex)

  const dx = Math.abs(end.x - start.x)
  const controlDist = Math.max(50, Math.min(dx * 0.6, 200))
  const d = `M ${start.x} ${start.y} C ${start.x + controlDist} ${start.y}, ${end.x - controlDist} ${end.y}, ${end.x} ${end.y}`

  return {
    d,
    startPoint: { x: start.x, y: start.y },
    endPoint: { x: end.x, y: end.y },
    colors: { start: colorStart, end: colorEnd }
  }
})
</script>

<template>
  <g v-if="pathInfo">
    <defs>
      <linearGradient
          :id="gradientId"
          gradientUnits="userSpaceOnUse"
          :x1="pathInfo.startPoint.x"
          :y1="pathInfo.startPoint.y"
          :x2="pathInfo.endPoint.x"
          :y2="pathInfo.endPoint.y"
      >
        <stop offset="0%" :stop-color="pathInfo.colors.start" stop-opacity="0.8" />
        <stop offset="100%" :stop-color="pathInfo.colors.end" stop-opacity="1" />
      </linearGradient>
    </defs>

    <path
        :d="pathInfo.d"
        fill="none"
        :stroke="pathInfo.colors.end"
        stroke-width="6"
        stroke-opacity="0.05"
        stroke-linecap="round"
        class="hover-zone"
    />

    <path
        :d="pathInfo.d"
        fill="none"
        :stroke="`url(#${gradientId})`"
        stroke-width="2"
        stroke-linecap="round"
        class="main-path"
    />

    <circle r="2">
      <animateMotion
          :path="pathInfo.d"
          dur="1.5s"
          repeatCount="indefinite"
          calcMode="spline"
          keyTimes="0;1"
          keySplines="0.4 0 0.2 1"
      />
      <animate
          attributeName="fill"
          :values="`${pathInfo.colors.start};${pathInfo.colors.end}`"
          dur="1.5s"
          repeatCount="indefinite"
          calcMode="spline"
          keyTimes="0;1"
          keySplines="0.4 0 0.2 1"
      />
    </circle>
  </g>
</template>

<style scoped>
.main-path {
  pointer-events: none;
  filter: drop-shadow(0 0 2px rgba(0,0,0,0.5));
  stroke-dasharray: 10, 5;
  animation: dash-flow 30s linear infinite;
}

.hover-zone {
  pointer-events: stroke;
  transition: stroke-opacity 0.2s;
  cursor: pointer;
}

.hover-zone:hover {
  stroke-opacity: 0.3;
}

@keyframes dash-flow {
  to { stroke-dashoffset: -1000; }
}
</style>