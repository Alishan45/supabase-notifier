import os
import time
import smtplib
from email.mime.text import MIMEText
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from supabase import create_client, Client
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
import logging
import threading

# Load environment variables from .env file
load_dotenv()

# Logger setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Validate required environment variables
required_env_vars = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "EMAIL",
    "EMAIL_PASSWORD",
    "TO_EMAIL"
]

missing_vars = [var for var in required_env_vars if not os.getenv(var)]
if missing_vars:
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

# Configuration with defaults for optional variables
CONFIG = {
    "SUPABASE_URL": os.getenv("SUPABASE_URL"),
    "SUPABASE_KEY": os.getenv("SUPABASE_KEY"),
    "EMAIL": os.getenv("EMAIL"),
    "EMAIL_PASSWORD": os.getenv("EMAIL_PASSWORD"),
    "TO_EMAIL": os.getenv("TO_EMAIL"),
    "SMTP_SERVER": os.getenv("SMTP_SERVER", "smtp.gmail.com"),
    "SMTP_PORT": int(os.getenv("SMTP_PORT", 465)),
    "DAILY_REPORT_HOUR": int(os.getenv("DAILY_REPORT_HOUR", 8)),
    "PAGE_SIZE": int(os.getenv("PAGE_SIZE", 5)),
    "FLASK_DEBUG": os.getenv("FLASK_DEBUG", "false").lower() == "true"
}

supabase: Client = create_client(CONFIG["SUPABASE_URL"], CONFIG["SUPABASE_KEY"])

# Email sending function
def send_email_notification(count: int, new_entries: List[Dict[str, Any]]) -> bool:
    try:
        subject = f"Supabase Notification: {count} new {'entry' if count == 1 else 'entries'} detected"
        entries_html = "<ul>"

        for entry in new_entries:
            timestamp_str = entry.get('submitted_at')
            formatted_time = 'N/A'
            if timestamp_str:
                try:
                    dt_utc = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00')).replace(tzinfo=timezone.utc)
                    local_tz = timezone(timedelta(hours=5))
                    dt_local = dt_utc.astimezone(local_tz)
                    formatted_time = dt_local.strftime('%Y-%m-%d %I:%M:%S %p %Z')
                except Exception as e:
                    logger.error(f"Timestamp error: {e}")
                    formatted_time = "Invalid timestamp"

            entries_html += f"""
                <li style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
                    <strong>Name:</strong> {entry.get('name', 'N/A')}<br>
                    <strong>Email:</strong> {entry.get('email', 'N/A')}<br>
                    <strong>Message:</strong> <div style="margin: 10px 0; padding: 10px; background: white;">{entry.get('message', 'N/A')}</div>
                    <strong>Timestamp:</strong> {formatted_time}
                </li>
            """

        entries_html += "</ul>"

        content = f"""
            <html><body style="font-family: Arial; color: #444;">
                <h2>New Entries Notification</h2>
                <p>Found {count} new entries:</p>
                {entries_html}
                <p style="color:#888;font-size:12px;">Sent at: {datetime.now(timezone(timedelta(hours=5))).strftime('%Y-%m-%d %I:%M:%S %p %Z')}</p>
            </body></html>
        """

        msg = MIMEText(content, 'html')
        msg['Subject'] = subject
        msg['From'] = CONFIG["EMAIL"]
        msg['To'] = CONFIG["TO_EMAIL"]

        with smtplib.SMTP_SSL(CONFIG["SMTP_SERVER"], CONFIG["SMTP_PORT"]) as server:
            server.login(CONFIG["EMAIL"], CONFIG["EMAIL_PASSWORD"])
            server.sendmail(CONFIG["EMAIL"], CONFIG["TO_EMAIL"], msg.as_string())

        logger.info("Notification email sent.")
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False

# Supabase polling logic
last_checked = datetime.now(timezone.utc)

def fetch_new_entries(since: datetime):
    response = supabase.table("contacts").select("*").gte("submitted_at", since.isoformat()).execute()
    if response.data:
        return response.data
    return []

def poll_supabase():
    global last_checked
    new_entries = fetch_new_entries(last_checked)
    logger.info(f"Polling: found {len(new_entries)} new entries")
    if new_entries:
        last_checked = datetime.now(timezone.utc)
        send_email_notification(len(new_entries), new_entries)

def run_polling():
    while True:
        poll_supabase()
        time.sleep(60)  # poll every 60 seconds


app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

# Start polling thread immediately on app startup
threading.Thread(target=run_polling, daemon=True).start()

# Routes
@app.route("/")
def home():
    """Serve the main HTML page"""
    return render_template("index.html")

@app.route("/static/<path:path>")
def serve_static(path):
    """Serve static files"""
    return send_from_directory('static', path)

@app.route("/api-status")
def api_status():
    """API status endpoint"""
    return jsonify({
        "status": "running",
        "supabase_connected": supabase is not None,
        "last_checked": last_checked.isoformat(),
        "config": {
            "email": CONFIG["EMAIL"],
            "to_email": CONFIG["TO_EMAIL"],
            "smtp_server": CONFIG["SMTP_SERVER"]
        }
    })

@app.route("/send-test-email", methods=["POST"])
def send_test_email():
    test_entry = {
        "name": "Test User",
        "email": "test@example.com",
        "message": "This is a test message from Supabase Notifier.",
        "submitted_at": datetime.now(timezone.utc).isoformat()
    }
    if send_email_notification(1, [test_entry]):
        return jsonify({"success": True, "message": "Test email sent successfully ✅"})
    return jsonify({"success": False, "message": "Failed to send test email ❌"}), 500

@app.route("/api/contacts", methods=["GET"])
def get_contacts():
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", CONFIG["PAGE_SIZE"]))
        offset = (page - 1) * limit

        search = request.args.get("search", "").strip()
        start_date = request.args.get("start_date", "").strip()
        end_date = request.args.get("end_date", "").strip()
        sort_by = request.args.get("sort_by", "submitted_at")
        sort_order = request.args.get("sort_order", "desc")

        # Build query
        query = supabase.table("contacts").select("*")

        # Apply filters
        if search:
            query = query.or_(f"name.ilike.%{search}%,email.ilike.%{search}%,message.ilike.%{search}%")
        
        if start_date:
            query = query.gte("submitted_at", start_date)
        
        if end_date:
            end_datetime = f"{end_date}T23:59:59.999Z"
            query = query.lte("submitted_at", end_datetime)

        # Apply sorting
        desc = sort_order.lower() == "desc"
        query = query.order(sort_by, desc=desc)

        # Get total count for pagination
        count_query = query
        count_response = count_query.execute()
        total_count = len(count_response.data)

        # Apply pagination
        response = query.range(offset, offset + limit - 1).execute()

        return jsonify({
            "data": response.data,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total_count,
                "pages": (total_count + limit - 1) // limit
            }
        })

    except Exception as e:
        logger.error(f"Error fetching contacts: {e}")
        return jsonify({"error": str(e)}), 500

