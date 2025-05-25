from flask import Flask, render_template, jsonify, request
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta
from supabase import create_client, Client
from email.mime.text import MIMEText
import smtplib
import os
from dotenv import load_dotenv
import logging
from typing import Optional, Dict, Any, List
import atexit

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Configuration
CONFIG = {
    "SUPABASE_URL": os.getenv("SUPABASE_URL"),
    "SUPABASE_KEY": os.getenv("SUPABASE_KEY"),
    "EMAIL": os.getenv("EMAIL"),
    "EMAIL_PASSWORD": os.getenv("EMAIL_PASSWORD"),
    "TO_EMAIL": os.getenv("TO_EMAIL"),
    "TABLE_NAME": "contacts",
    "SMTP_SERVER": os.getenv("SMTP_SERVER", "smtp.gmail.com"),
    "SMTP_PORT": int(os.getenv("SMTP_PORT", 465)),
    "DAILY_REPORT_HOUR": int(os.getenv("DAILY_REPORT_HOUR", 8)),
    "PAGE_SIZE": int(os.getenv("PAGE_SIZE", 5))
}

# Validate required config
for key, value in CONFIG.items():
    if not value and key not in ["SMTP_SERVER", "SMTP_PORT", "DAILY_REPORT_HOUR"]:
        raise ValueError(f"Missing required environment variable: {key}")

# Initialize Supabase client
try:
    supabase: Client = create_client(CONFIG["SUPABASE_URL"], CONFIG["SUPABASE_KEY"])
    logger.info("Successfully connected to Supabase")
except Exception as e:
    logger.error(f"Failed to initialize Supabase client: {e}")
    raise

app = Flask(__name__)
scheduler = BackgroundScheduler(daemon=True)

def check_new_entries() -> None:
    """Check for new entries in the last 24 hours and send email notification."""
    try:
        now = datetime.utcnow()
        start_of_yesterday = now - timedelta(days=1)
        
        logger.info(f"Checking for new entries between {start_of_yesterday} and {now}")
        
        response = supabase.table(CONFIG["TABLE_NAME"]).select("*")\
            .gte("submitted_at", start_of_yesterday.isoformat())\
            .lte("submitted_at", now.isoformat())\
            .execute()
        
        count = len(response.data)
        logger.info(f"Found {count} new entries")
        
        if count > 0:
            send_email(count)
    except Exception as e:
        logger.error(f"Error in check_new_entries: {e}")

def send_email(count: int, test: bool = False) -> bool:
    """Send email notification with new entries count or test email."""
    try:
        if test:
            content = "📨 This is a test email from Supabase Notifier."
            subject = "Test Email - Supabase Notifier"
        else:
            content = f"{count} new contact message(s) were submitted in the last 24 hours."
            subject = f"Supabase Notification: {count} new entries"
        
        msg = MIMEText(content)
        msg["Subject"] = subject
        msg["From"] = CONFIG["EMAIL"]
        msg["To"] = CONFIG["TO_EMAIL"]
        
        with smtplib.SMTP_SSL(CONFIG["SMTP_SERVER"], CONFIG["SMTP_PORT"]) as server:
            server.login(CONFIG["EMAIL"], CONFIG["EMAIL_PASSWORD"])
            server.sendmail(CONFIG["EMAIL"], CONFIG["TO_EMAIL"], msg.as_string())
        
        logger.info(f"Email sent successfully (test={test})")
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False

# Schedule daily check
scheduler.add_job(
    func=check_new_entries,
    trigger="cron",
    hour=CONFIG["DAILY_REPORT_HOUR"],
    name="daily_entry_check"
)
scheduler.start()

@app.route("/")
def home() -> str:
    """Render the main dashboard page."""
    return render_template("index.html")

@app.route("/send-test-email", methods=["POST"])
def send_test_email() -> Dict[str, Any]:
    """Endpoint to send a test email."""
    try:
        success = send_email(count=0, test=True)
        if success:
            return jsonify({"success": True, "message": "Test email sent successfully!"})
        else:
            return jsonify({"success": False, "message": "Failed to send test email"}), 500
    except Exception as e:
        logger.error(f"Error in send_test_email: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route("/api/contacts")
def get_contacts() -> Dict[str, Any]:
    """API endpoint to fetch contacts with pagination and filtering."""
    try:
        # Get query parameters
        search_query = request.args.get("search", "").strip()
        page = max(1, int(request.args.get("page", 1)))
        limit = min(50, max(1, int(request.args.get("limit", CONFIG["PAGE_SIZE"]))))
        offset = (page - 1) * limit
        
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")
        sort_by = request.args.get("sort_by", "submitted_at")
        sort_order = request.args.get("sort_order", "desc")
        
        # Build query
        query = supabase.table(CONFIG["TABLE_NAME"]).select("*")
        
        # Apply search filter
        if search_query:
            query = query.or_(
                f"name.ilike.%{search_query}%,email.ilike.%{search_query}%,message.ilike.%{search_query}%"
            )
        
        # Apply date filters
        if start_date:
            query = query.gte("submitted_at", f"{start_date}T00:00:00Z")
        if end_date:
            query = query.lte("submitted_at", f"{end_date}T23:59:59Z")
        
        # Apply sorting
        query = query.order(sort_by, desc=(sort_order.lower() == "desc"))
        
        # Apply pagination
        data = query.range(offset, offset + limit - 1).execute()
        
        logger.info(f"Fetched {len(data.data)} contacts (page={page}, limit={limit})")
        return jsonify(data.data)
    except Exception as e:
        logger.error(f"Error in get_contacts: {e}")
        return jsonify({"error": str(e)}), 500

# Cleanup on exit
atexit.register(lambda: scheduler.shutdown(wait=False))
