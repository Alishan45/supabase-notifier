let currentPage = 1;
const limit = 10;
let isLoading = false;
let hasMore = true;

// Enhanced clock with date display that updates every second
function updateClock() {
    try {
        const now = new Date();
        const clock = document.getElementById("clock");
        if (clock) {
            clock.textContent = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
        }
    } catch (e) {
        console.error("Clock update error:", e);
    }
}

// Theme management with preference detection and system preference fallback
function toggleTheme() {
    try {
        document.body.classList.toggle("dark");
        const isDark = document.body.classList.contains("dark");
        localStorage.setItem("theme", isDark ? "dark" : "light");
        
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
            themeColorMeta.content = isDark ? "#1a1a1a" : "#ffffff";
        }
    } catch (e) {
        console.error("Theme toggle error:", e);
    }
}

// Email sending with loading state and better error handling
async function sendRealTestEmail() {
    const button = document.getElementById("testEmailBtn");
    const preview = document.getElementById("previewMessage");
    
    if (!button || !preview) return;

    const originalText = button.textContent;
    
    try {
        button.disabled = true;
        button.textContent = "Sending...";
        
        const response = await fetch("/send-test-email", { 
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        preview.textContent = data.success ? data.message : `❌ ${data.message}`;
        preview.className = data.success ? "success" : "error";
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to send email');
        }
    } catch (err) {
        console.error("Email sending error:", err);
        preview.textContent = "❌ Failed to send email. Please try again.";
        preview.className = "error";
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

// Highlight search matches with HTML escaping for security
function highlightMatch(text, query) {
    if (!query || !text) return text ? escapeHtml(text) : '';
    
    try {
        const escapedText = escapeHtml(text);
        const escapedQuery = escapeHtml(query);
        const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escapedText.replace(regex, "<mark>$1</mark>");
    } catch (e) {
        console.error("Highlight error:", e);
        return escapeHtml(text);
    }
}

// Robust HTML escaping to prevent XSS
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Get all filter values with null checks
function getFilters() {
    return {
        search: document.getElementById("searchInput")?.value.trim() || '',
        startDate: document.getElementById("startDate")?.value || '',
        endDate: document.getElementById("endDate")?.value || '',
        sortBy: document.getElementById("sortBy")?.value || 'submitted_at',
        sortOrder: document.getElementById("sortOrder")?.value || 'desc'
    };
}

// Reset pagination and reload contacts
function resetAndLoad() {
    currentPage = 1;
    hasMore = true;
    const contactList = document.getElementById("contactList");
    if (contactList) contactList.innerHTML = "";
    loadContacts();
}

async function loadContacts() {
    if (isLoading || !hasMore) return;
    
    isLoading = true;
    const loader = document.getElementById("loader");
    const contactList = document.getElementById("contactList");
    const pageNumber = document.getElementById("pageNumber");
    
    try {
        if (loader) loader.style.display = "block";
        
        const { search, startDate, endDate, sortBy, sortOrder } = getFilters();
        
        const params = new URLSearchParams({
            page: currentPage,
            limit,
            search,
            start_date: startDate,
            end_date: endDate,
            sort_by: sortBy,
            sort_order: sortOrder
        });

        const response = await fetch(`/api/contacts?${params.toString()}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const data = result.data || [];
        const pagination = result.pagination || {};
        
        if (!contactList) return;

        if (data.length === 0) {
            if (currentPage === 1) {
                contactList.innerHTML = `
                    <tr>
                        <td colspan="4" class="no-results">No contacts found matching your criteria.</td>
                    </tr>
                `;
            }
            hasMore = false;
            return;
        }

        // Create document fragment for better performance
        const fragment = document.createDocumentFragment();
        
        data.forEach(item => {
            const row = document.createElement("tr");
            row.className = "contact-item";
            row.innerHTML = `
                <td>${highlightMatch(item.name, search)}</td>
                <td>${highlightMatch(item.email, search)}</td>
                <td class="message-cell" title="${escapeHtml(item.message || '')}">
                    ${highlightMatch(truncateMessage(item.message), search)}
                </td>
                <td>${formatDateTime(item.submitted_at)}</td>
            `;
            fragment.appendChild(row);
        });

        contactList.appendChild(fragment);
        currentPage += 1;
        hasMore = data.length === limit;
        
    } catch (error) {
        console.error("Failed to load contacts:", error);
        if (contactList) {
            contactList.innerHTML = `
                <tr>
                    <td colspan="4" class="error">Failed to load contacts. Please try again later.</td>
                </tr>
            `;
        }
    } finally {
        isLoading = false;
        if (loader) loader.style.display = "none";
        if (pageNumber) pageNumber.textContent = `Page ${currentPage - 1}`;
    }
}

// Helper function to truncate long messages
function truncateMessage(message, length = 100) {
    if (!message) return '';
    return message.length > length ? `${message.substring(0, length)}...` : message;
}

// Helper function to format date/time
function formatDateTime(isoString) {
    try {
        return new Date(isoString).toLocaleString();
    } catch (e) {
        console.error("Date formatting error:", e);
        return isoString;
    }
}

// Infinite scroll implementation with throttle
function setupInfiniteScroll() {
    let isThrottled = false;
    
    window.addEventListener('scroll', () => {
        if (isThrottled) return;
        
        isThrottled = true;
        setTimeout(() => {
            isThrottled = false;
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
                loadContacts();
            }
        }, 200);
    });
}

// Initialize the application with proper error handling
function initializeApp() {
    try {
        updateClock();
        setInterval(updateClock, 1000);

        // Set initial theme
        const preferredTheme = localStorage.getItem("theme") || 
                             (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        if (preferredTheme === 'dark') document.body.classList.add("dark");

        // Set up event listeners with null checks
        const searchInput = document.getElementById("searchInput");
        const startDate = document.getElementById("startDate");
        const endDate = document.getElementById("endDate");
        const sortBy = document.getElementById("sortBy");
        const sortOrder = document.getElementById("sortOrder");

        if (searchInput) searchInput.addEventListener('input', debounce(resetAndLoad, 300));
        if (startDate) startDate.addEventListener('change', resetAndLoad);
        if (endDate) endDate.addEventListener('change', resetAndLoad);
        if (sortBy) sortBy.addEventListener('change', resetAndLoad);
        if (sortOrder) sortOrder.addEventListener('change', resetAndLoad);

        setupInfiniteScroll();
        loadContacts();
    } catch (e) {
        console.error("Initialization error:", e);
    }
}

// Improved debounce function
function debounce(func, wait, immediate = false) {
    let timeout;
    return function() {
        const context = this, args = arguments;
        const later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
