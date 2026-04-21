document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('sketchpad');
    const ctx = canvas.getContext('2d');
    const clearBtn = document.getElementById('clearBtn');
    const animateBtn = document.getElementById('animateBtn');
    
    const emptyState = document.getElementById('emptyState');
    const loader = document.getElementById('loader');
    const statusMsg = document.getElementById('statusMsg');
    
    const resultDisplay = document.getElementById('resultDisplay');
    const animatedGif = document.getElementById('animatedGif');
    const predCategory = document.getElementById('predCategory');
    const predConf = document.getElementById('predConf');

    // Initialize canvas with white background
    function initCanvas() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#000000';
    }
    
    initCanvas();

    // Drawing state
    let isDrawing = false;
    let hasDrawn = false;
    let lastX = 0;
    let lastY = 0;
    let inactivityTimer = null;
    const INACTIVITY_DELAY = 10000; // 10 seconds

    let strokes = [];
    let currentStrokeX = [];
    let currentStrokeY = [];

    function resetInactivityTimer() {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (hasDrawn) {
            statusMsg.innerText = 'AI will animate in 10s if no drawing...';
            inactivityTimer = setTimeout(() => {
                triggerAnimation();
            }, INACTIVITY_DELAY);
        }
    }

    function getCoordinates(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.clientX || e.touches?.[0].clientX;
        const clientY = e.clientY || e.touches?.[0].clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function startDrawing(e) {
        isDrawing = true;
        hasDrawn = true;
        const {x, y} = getCoordinates(e);
        lastX = x;
        lastY = y;
        currentStrokeX = [x];
        currentStrokeY = [y];
        resetInactivityTimer();
        draw(e); 
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        
        resetInactivityTimer();
        const {x, y} = getCoordinates(e);

        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();

        currentStrokeX.push(x);
        currentStrokeY.push(y);

        lastX = x;
        lastY = y;
    }

    function stopDrawing() {
        if (isDrawing) {
            strokes.push([currentStrokeX, currentStrokeY]);
            currentStrokeX = [];
            currentStrokeY = [];
        }
        isDrawing = false;
        resetInactivityTimer();
    }

    // Event listeners
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    
    // Touch support for mobile
    canvas.addEventListener('touchstart', startDrawing, {passive: false});
    canvas.addEventListener('touchmove', draw, {passive: false});
    canvas.addEventListener('touchend', stopDrawing);

    clearBtn.addEventListener('click', () => {
        initCanvas();
        hasDrawn = false;
        strokes = [];
        if (inactivityTimer) clearTimeout(inactivityTimer);
        resultDisplay.style.display = 'none';
        emptyState.style.display = 'block';
        statusMsg.innerText = 'Your animation will appear here.';
    });

    async function triggerAnimation() {
        if (!hasDrawn) return;
        
        emptyState.style.display = 'block';
        resultDisplay.style.display = 'none';
        loader.style.display = 'block';
        statusMsg.innerText = 'AI is analyzing your sketch...';
        
        try {
            const dataUrl = canvas.toDataURL('image/png');
            
            const response = await fetch('/api/animate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: dataUrl, strokes: strokes })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Server error');
            }
            
            emptyState.style.display = 'none';
            resultDisplay.style.display = 'flex';
            
            animatedGif.src = result.gif_url + '?t=' + new Date().getTime();
            
            predCategory.innerText = result.category;
            predConf.innerText = (result.confidence * 100).toFixed(1);
            
        } catch (error) {
            console.error('Error animating sketch:', error);
            loader.style.display = 'none';
            statusMsg.innerText = 'Error: ' + error.message;
        }
    }
});
