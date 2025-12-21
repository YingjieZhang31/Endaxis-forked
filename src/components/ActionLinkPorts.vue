<script setup>
import { ref } from 'vue'

const props = defineProps({
    show: { type: Boolean, default: true },
    color: { type: String, default: '#fff' },
    isDragging: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    canStart: { type: Boolean, default: false }
})

const emit = defineEmits(['drag-start', 'drop', 'snap', 'clear-snap'])

const activePort = ref(null)
const isOverPort = ref(false)
const portOverlayRef = ref(null)
const portRefs = {}

function calculateActivePort(x, y) {
    if (!portOverlayRef.value) {
        return 'left'
    }
    const rect = portOverlayRef.value.getBoundingClientRect()
    const relX = x - rect.left
    const relY = y - rect.top

    const distLeft = relX
    const distRight = rect.width - relX
    const distTop = relY
    const distBottom = rect.height - relY

    const min = Math.min(distLeft, distRight, distTop, distBottom)
    switch (true) {
        case min === distTop:
            return {
                side: 'top',
                x: rect.left + rect.width / 2,
                y: rect.top
            }
        case min === distBottom:
            return {
                side: 'bottom',
                x: rect.left + rect.width / 2,
                y: rect.bottom
            }
        case min === distRight:
            return {
                side: 'right',
                x: rect.right,
                y: rect.top + rect.height / 2
            }
        default:
            return {
                side: 'left',
                x: rect.left,
                y: rect.top + rect.height / 2
            }
    }
}

function onOverlayMouseUp(evt) {
    if (!props.isDragging) {
        return
    }
    const port = calculateActivePort(evt.clientX, evt.clientY)
    emit('drop', port.side)
}

function onOverlayMouseLeave() {
    emit('clear-snap')
}

function onOverlayMouseMove(evt) {
    if (isOverPort.value || !props.isDragging) {
        return
    }
    const port = calculateActivePort(evt.clientX, evt.clientY)
    activePort.value = port.side
    const ref = portRefs[port.side]
    if (!ref) {
        return
    }
    emit('snap', port.side, { x: port.x, y: port.y })
}

function onPortMouseEnter(evt, port) {
    if (!props.canStart || props.disabled) {
        return
    }
    activePort.value = port.side
    isOverPort.value = true
    if (props.isDragging) {
        const { x, y } = calculateActivePort(evt.clientX, evt.clientY)
        emit('snap', port.side, { x, y })
    }
}

function onPortMouseLeave() {
    activePort.value = null
    isOverPort.value = false
    emit('clear-snap')
}

function onPortMouseDown(evt) {
    if (!props.canStart || props.disabled) {
        return
    }
    emit('drag-start', { x: evt.clientX, y: evt.clientY }, activePort.value)
}

function onPortMouseUp(evt) {
    emit('drop', activePort.value)
}

const ports = [
    { side: 'top', class: 'port-top' },
    { side: 'bottom', class: 'port-bottom' },
    { side: 'left', class: 'port-left' },
    { side: 'right', class: 'port-right' }
]

</script>

<template>
    <div ref="portOverlayRef" :class="{ 'action-link-ports': true, 'hidden': !show, 'is-dragging': isDragging, 'disabled': disabled }"
        @mousemove.stop="onOverlayMouseMove" @mouseup.stop="onOverlayMouseUp" @mouseleave.stop="onOverlayMouseLeave">
        <div v-for="p in ports" :key="p.side" :ref="el => portRefs[p.side] = el"
            :style="{ '--background-color': color }"
            :class="['link-port', p.class, `port-${p.side}`, { 'active': activePort === p.side }, { 'disabled': disabled }]"
            @mousedown.stop.prevent="onPortMouseDown($event, p)" @mouseenter.stop="onPortMouseEnter($event, p)"
            @mouseleave.stop="onPortMouseLeave" @mouseup.stop="onPortMouseUp" title="拖拽连线">
        </div>
    </div>
</template>

<style scoped>
.action-link-ports {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 20;
    transition: opacity 0.2s, transform 0.2s, background-color 0.2s;
    opacity: 1;

    &.hidden {
        opacity: 0;
    }

    &.is-dragging {
        pointer-events: auto;
    }

    &.disabled {
        opacity: 0.1;
        pointer-events: none;
        cursor: default;
    }
}

.link-port {
    position: absolute;
    width: 8px;
    height: 8px;
    background-color: var(--background-color);
    border-radius: 50%;
    cursor: crosshair;
    pointer-events: auto;

    &.disabled {
        pointer-events: none;
    }

    &:hover {
        transform: scale(1.2);
        background-color: #ffd700;
        border-color: #ffd700;
    }
}

.port-top {
    left: 50%;
    top: -5px;
    transform: translateX(-50%);

    &.active {
        transform: translateX(-50%) scale(1.2);
    }
}

.port-bottom {
    left: 50%;
    bottom: -5px;
    transform: translateX(-50%);

    &.active {
        transform: translateX(-50%) scale(1.2);
    }
}

.port-left {
    top: 50%;
    left: -5px;
    transform: translateY(-50%);

    &.active {
        transform: translateY(-50%) scale(1.2);
    }
}

.port-right {
    top: 50%;
    right: -5px;
    transform: translateY(-50%);

    &.active {
        transform: translateY(-50%) scale(1.2);
    }
}
</style>
