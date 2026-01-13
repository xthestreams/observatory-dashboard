/**
 * Observatory Configurator - Client-side JavaScript
 */

// Utility function for API calls
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Toast notification helper
function showToast(message, type = 'info') {
    // Simple alert for now - could be enhanced with a toast library
    alert(message);
}

// Format timestamp for display
function formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// Debounce function for rate limiting
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Initialize page-specific functionality
document.addEventListener('DOMContentLoaded', function() {
    // Add smooth scrolling
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });

    // Add keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + S to save (on config page)
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            const saveBtn = document.querySelector('#btn-save, button[onclick*="saveConfig"]');
            if (saveBtn) {
                e.preventDefault();
                saveBtn.click();
            }
        }
    });
});
