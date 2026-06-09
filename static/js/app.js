async function fetchEpisodes() {
    const token = document.getElementById('token').value;
    const series_id = document.getElementById('series_id').value;
    const results = document.getElementById('results');
    const downloadBtn = document.getElementById('downloadBtn');
    const btnContent = downloadBtn.querySelector('.btn-content');
    const loadingText = downloadBtn.querySelector('.loading-text');
    const loader = downloadBtn.querySelector('.loader');

    if (!series_id) {
        results.innerText = 'กรุณาใส่ Series ID';
        results.style.color = '#FF3B30'; // iOS Red
        return;
    }

    // UI Loading State
    results.innerText = '';
    downloadBtn.disabled = true;
    btnContent.classList.add('hidden');
    loadingText.classList.add('visible');
    loader.style.display = 'block';

    try {
        const response = await fetch('/fetch-episodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, series_id })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'เกิดข้อผิดพลาดในการดึงข้อมูล');
        }

        // Trigger download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${series_id}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        results.innerText = '✨ ดาวน์โหลดไฟล์เรียบร้อยแล้ว!';
        results.style.color = '#34C759'; // iOS Green
    } catch (error) {
        results.innerText = '❌ ' + error.message;
        results.style.color = '#FF3B30'; // iOS Red
    } finally {
        // Restore UI State
        downloadBtn.disabled = false;
        btnContent.classList.remove('hidden');
        loadingText.classList.remove('visible');
        loader.style.display = 'none';
    }
}
