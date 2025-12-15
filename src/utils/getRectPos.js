export function getRectPos(rect, position) {
    switch (position) {
        case 'center':
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            }
        case 'left':
            return {
                x: rect.left,
                y: rect.top + rect.height / 2
            }
        case 'right':
            return {
                x: rect.left + rect.width,
                y: rect.top + rect.height / 2
            }
        case 'top':
            return {
                x: rect.left + rect.width / 2,
                y: rect.top
            }
        case 'bottom':
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height
            }
    }
}