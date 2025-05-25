let currentPage = 1;
const limit = 10; // Increased limit for better table display
let isLoading = false;
let hasMore = true;

// Enhanced clock with date display
function updateClock() {
    const now = new Date();
    const clock = document.getElementById("clock");
    clock.textContent = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
}

// Theme management with preference detection
function toggleTheme() {
    document.body.classList.toggle("dark");
    const isDark = document.body.classList.contains("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    
    document.querySelector('meta[name="theme-color"]').content = 
        isDark ? "#1a1a1a" : "#ffffff";
}

// Email sending with loading state
function sendRealTestEmail() {
    const button = document.getElementById("testEmailBtn");
    const originalText = button.textContent;
    
    button.disabled = true;
    button.textContent = "Sending...";
    
    fetch("/send-test-email", { method: "POST" })
        .then(res => res.json())
        .then(data => {
            const preview = document.getElementById("previewMessage");
            preview.textContent = data.success ? data.message : `❌ ${data.message}`;
            preview.className = data.success ? "success" : "error";
        })
        .catch(err => {
            document.getElementById("previewMessage").textContent = "❌ Failed to send email.";
            console.error(err);
        })
        .finally(() => {
            button.disabled = false;
            button.textContent = originalText;
        });
}

// Highlight search matches with HTML escaping for security
function highlightMatch(text, query) {
    if (!query || !text) return text ? escapeHtml(text) : '';
    
    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, "<mark>$1</mark>");
}

// Basic HTML escaping to prevent XSS
function escapeHtml(unsafe) {
    return unsafe?.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;") || '';
}

// Get all filter values
function getFilters() {
    return {
        search: document.getElementById("searchInput").value.trim(),
        startDate: document.getElementById("startDate").value,
        endDate: document.getElementById("endDate").value,
        sortBy: document.getElementById("sortBy").value,
        sortOrder: document.getElementById("sortOrder").value
    };
}

// Reset pagination and reload
function resetAndLoad() {
    currentPage = 1;
    hasMore = true;
    document.getElementById("contactList").innerHTML = "";
    loadContacts();
}

// Load contacts with error handling and loading state (updated)
function loadContacts() {
    if (isLoading || !hasMore) return;
    
    isLoading = true;
    const loader = document.getElementById("loader");
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

    fetch(`/api/contacts?${params.toString()}`)
        .then(res => {
            if (!res.ok) throw new Error('Network response was not ok');
            return res.json();
        })
        .then(data => {
            const tableBody = document.getElementById("contactList");
            
            if (data.length === 0) {
                if (currentPage === 1) {
                    tableBody.innerHTML = `
                        <tr>
                            <td colspan="4" class="no-results">No contacts found matching your criteria.</td>
                        </tr>
                    `;
                }
                hasMore = false;
                return;
            }

            // ✅ Updated row creation
            data.forEach((item, index) => {
                const row = document.createElement("tr");
                row.className = "contact-item";
                row.innerHTML = `
                    <td>${highlightMatch(item.name, search)}</td>
                    <td>${highlightMatch(item.email, search)}</td>
                    <td class="message-cell" title="${escapeHtml(item.message || '')}">
                        ${highlightMatch(item.message, search)}
                    </td>
                    <td>${new Date(item.submitted_at).toLocaleString()}</td>
                `;
                tableBody.appendChild(row);
            });

            currentPage += 1;
            hasMore = data.length === limit;
        })
        .catch(err => {
            console.error("Failed to load contacts:", err);
            document.getElementById("contactList").innerHTML = `
                <tr>
                    <td colspan="4" class="error">Failed to load contacts. Please try again later.</td>
                </tr>
            `;
        })
        .finally(() => {
            isLoading = false;
            if (loader) loader.style.display = "none";
            document.getElementById("pageNumber").textContent = `Page ${currentPage - 1}`;
        });
}

// Infinite scroll implementation
function setupInfiniteScroll() {
    window.addEventListener('scroll', () => {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
            loadContacts();
        }
    });
}

// Initialize the application
window.onload = () => {
    updateClock();
    setInterval(updateClock, 1000);

    // Set initial theme
    const preferredTheme = localStorage.getItem("theme") || 
                         (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (preferredTheme === 'dark') document.body.classList.add("dark");

    // Set up event listeners
    document.getElementById("searchInput").addEventListener('input', 
        debounce(resetAndLoad, 300));
    document.getElementById("startDate").addEventListener('change', resetAndLoad);
    document.getElementById("endDate").addEventListener('change', resetAndLoad);
    document.getElementById("sortBy").addEventListener('change', resetAndLoad);
    document.getElementById("sortOrder").addEventListener('change', resetAndLoad);

    setupInfiniteScroll();
    loadContacts();
};

// Utility function to debounce rapid events
function debounce(func, wait) {
    let timeout;
    return function() {
        const context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}