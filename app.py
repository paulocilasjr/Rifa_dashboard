from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask,
    current_app,
    flash,
    g,
    make_response,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

MAX_NUMBER = 100000
PAGE_SIZE = 500
RESERVE_MINUTES = 15
DEFAULT_SECRET_KEY = "casamentoguto"
DEFAULT_SUPERUSER_USERNAME = "guto"
DEFAULT_SUPERUSER_PASSWORD = "casamento"


def now_ts() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def reserve_until_ts() -> str:
    return (datetime.utcnow() + timedelta(minutes=RESERVE_MINUTES)).isoformat(
        timespec="seconds"
    )


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", DEFAULT_SECRET_KEY)

    os.makedirs(app.instance_path, exist_ok=True)
    app.config["DATABASE"] = os.path.join(app.instance_path, "raffle.db")

    with app.app_context():
        init_db()
        bootstrap_superuser()

    @app.before_request
    def load_logged_in_user() -> None:
        user_id = session.get("user_id")
        if user_id is None:
            g.user = None
            return
        g.user = query_one("SELECT id, username, role FROM users WHERE id = ?", (user_id,))

    @app.route("/")
    def index():
        if g.user is None:
            return redirect(url_for("login"))
        if g.user["role"] == "superuser":
            return redirect(url_for("admin_dashboard"))
        return redirect(url_for("seller_dashboard"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = query_one(
                "SELECT id, username, password_hash, role FROM users WHERE username = ?",
                (username,),
            )
            error = None
            if user is None or not check_password_hash(user["password_hash"], password):
                error = "Invalid username or password."

            if error is None:
                session.clear()
                session["user_id"] = user["id"]
                return redirect(url_for("index"))

            flash(error, "error")
        return render_template("login.html")

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    def login_required(view):
        @wraps(view)
        def wrapped_view(**kwargs):
            if g.user is None:
                return redirect(url_for("login"))
            return view(**kwargs)

        return wrapped_view

    def superuser_required(view):
        @wraps(view)
        def wrapped_view(**kwargs):
            if g.user is None:
                return redirect(url_for("login"))
            if g.user["role"] != "superuser":
                flash("Superuser access required.", "error")
                return redirect(url_for("seller_dashboard"))
            return view(**kwargs)

        return wrapped_view

    @app.route("/seller", methods=["GET", "POST"])
    @login_required
    def seller_dashboard():
        if g.user["role"] == "superuser":
            return redirect(url_for("admin_dashboard"))

        cleanup_expired_reservations()

        if request.method == "POST":
            action = request.form.get("action", "sell")
            selected_numbers = request.form.getlist("numbers")
            buyer_name = request.form.get("buyer_name", "").strip()
            buyer_phone = request.form.get("buyer_phone", "").strip()
            clear_selection = False

            error = None
            if not selected_numbers:
                error = "Select at least one number."
            elif action == "sell" and (not buyer_name or not buyer_phone):
                error = "Buyer name and phone are required to complete a sale."

            numbers: list[int] = []
            if error is None:
                for raw in selected_numbers:
                    try:
                        number = int(raw)
                    except ValueError:
                        error = "Invalid number selection."
                        break
                    if number < 1 or number > MAX_NUMBER:
                        error = "One or more numbers are out of range."
                        break
                    numbers.append(number)

            if error is None:
                db = get_db()
                try:
                    db.execute("BEGIN IMMEDIATE")
                    now = now_ts()

                    if action == "reserve":
                        reserve_until = reserve_until_ts()
                        for number in numbers:
                            sold = db.execute(
                                "SELECT 1 FROM sales WHERE number = ?", (number,)
                            ).fetchone()
                            if sold:
                                error = f"Number {number} is already sold."
                                break

                            existing = db.execute(
                                "SELECT seller_id FROM reservations WHERE number = ?",
                                (number,),
                            ).fetchone()
                            if existing:
                                if existing["seller_id"] == g.user["id"]:
                                    db.execute(
                                        "UPDATE reservations SET reserved_until = ? WHERE number = ?",
                                        (reserve_until, number),
                                    )
                                    log_audit(
                                        "reservation_extend",
                                        g.user["id"],
                                        number=number,
                                        seller_id=g.user["id"],
                                        details={"reserved_until": reserve_until},
                                        db=db,
                                    )
                                else:
                                    error = f"Number {number} is already reserved."
                                    break
                            else:
                                db.execute(
                                    "INSERT INTO reservations (number, seller_id, reserved_at, reserved_until) "
                                    "VALUES (?, ?, ?, ?)",
                                    (number, g.user["id"], now, reserve_until),
                                )
                                log_audit(
                                    "reservation_create",
                                    g.user["id"],
                                    number=number,
                                    seller_id=g.user["id"],
                                    details={"reserved_until": reserve_until},
                                    db=db,
                                )

                        if error:
                            db.rollback()
                        else:
                            db.commit()
                            flash(
                                f"Reserved {len(numbers)} number(s) for {RESERVE_MINUTES} minutes.",
                                "success",
                            )
                            clear_selection = True

                    else:
                        for number in numbers:
                            sold = db.execute(
                                "SELECT 1 FROM sales WHERE number = ?", (number,)
                            ).fetchone()
                            if sold:
                                error = f"Number {number} is already sold."
                                break

                            reservation = db.execute(
                                "SELECT seller_id FROM reservations WHERE number = ?",
                                (number,),
                            ).fetchone()
                            if reservation and reservation["seller_id"] != g.user["id"]:
                                error = f"Number {number} is reserved by another seller."
                                break

                        if error:
                            db.rollback()
                        else:
                            for number in numbers:
                                db.execute(
                                    "INSERT INTO sales (number, seller_id, buyer_name, buyer_phone, sold_at) "
                                    "VALUES (?, ?, ?, ?, ?)",
                                    (number, g.user["id"], buyer_name, buyer_phone, now),
                                )
                                db.execute(
                                    "DELETE FROM reservations WHERE number = ?",
                                    (number,),
                                )
                                log_audit(
                                    "sale_create",
                                    g.user["id"],
                                    number=number,
                                    seller_id=g.user["id"],
                                    details={
                                        "buyer_name": buyer_name,
                                        "buyer_phone": buyer_phone,
                                        "sold_at": now,
                                    },
                                    db=db,
                                )

                            db.commit()
                            flash(f"Sold {len(numbers)} number(s).", "success")
                            clear_selection = True

                except sqlite3.IntegrityError:
                    db.rollback()
                    flash(
                        "One or more numbers were already taken. Please refresh and try again.",
                        "error",
                    )
                except sqlite3.Error:
                    db.rollback()
                    flash("Database error. Please try again.", "error")

            if error:
                flash(error, "error")
            if clear_selection:
                return redirect(url_for("seller_dashboard", clear_selection=1))
            return redirect(url_for("seller_dashboard"))

        total_sold = query_value(
            "SELECT COUNT(*) FROM sales WHERE seller_id = ?", (g.user["id"],)
        )
        total_reserved = query_value(
            "SELECT COUNT(*) FROM reservations WHERE seller_id = ?", (g.user["id"],)
        )

        page = parse_int(request.args.get("page"), 1)
        page_count = (MAX_NUMBER + PAGE_SIZE - 1) // PAGE_SIZE
        page = max(1, min(page, page_count))
        start = (page - 1) * PAGE_SIZE + 1
        end = min(page * PAGE_SIZE, MAX_NUMBER)

        sold_numbers = query_all(
            "SELECT number FROM sales WHERE number BETWEEN ? AND ?",
            (start, end),
        )
        sold_set = {row["number"] for row in sold_numbers}

        reservation_rows = query_all(
            "SELECT number, seller_id FROM reservations WHERE number BETWEEN ? AND ?",
            (start, end),
        )
        reserved_by_me = {row["number"] for row in reservation_rows if row["seller_id"] == g.user["id"]}
        reserved_by_other = {
            row["number"] for row in reservation_rows if row["seller_id"] != g.user["id"]
        }

        search_number = parse_int(request.args.get("number"), None)
        search_result = None
        if search_number is not None:
            if 1 <= search_number <= MAX_NUMBER:
                sale = query_one(
                    "SELECT number, seller_id, buyer_name, buyer_phone, sold_at "
                    "FROM sales WHERE number = ?",
                    (search_number,),
                )
                if sale:
                    search_result = {
                        "status": "sold",
                        "number": search_number,
                        "buyer_name": sale["buyer_name"],
                        "buyer_phone": sale["buyer_phone"],
                        "sold_at": sale["sold_at"],
                        "can_edit": sale["seller_id"] == g.user["id"],
                    }
                else:
                    reservation = query_one(
                        "SELECT number, seller_id, reserved_until FROM reservations WHERE number = ?",
                        (search_number,),
                    )
                    if reservation:
                        search_result = {
                            "status": "reserved",
                            "number": search_number,
                            "reserved_until": reservation["reserved_until"],
                            "reserved_by_me": reservation["seller_id"] == g.user["id"],
                        }
                    else:
                        search_result = {"status": "available", "number": search_number}
            else:
                flash("Search number is out of range.", "error")

        numbers = []
        for number in range(start, end + 1):
            numbers.append(
                {
                    "number": number,
                    "sold": number in sold_set,
                    "reserved_by_me": number in reserved_by_me,
                    "reserved_by_other": number in reserved_by_other,
                }
            )

        my_reservations = query_all(
            "SELECT number, reserved_until FROM reservations WHERE seller_id = ? ORDER BY reserved_until ASC",
            (g.user["id"],),
        )

        return render_template(
            "seller_dashboard.html",
            total_sold=total_sold,
            total_reserved=total_reserved,
            numbers=numbers,
            page=page,
            page_count=page_count,
            start=start,
            end=end,
            max_number=MAX_NUMBER,
            search_result=search_result,
            my_reservations=my_reservations,
            reserve_minutes=RESERVE_MINUTES,
        )

    @app.route("/sale/<int:number>/edit", methods=["POST"])
    @login_required
    def edit_sale(number: int):
        sale = query_one(
            "SELECT number, seller_id, buyer_name, buyer_phone, sold_at FROM sales WHERE number = ?",
            (number,),
        )
        if not sale:
            flash("Sale not found.", "error")
            return redirect(request.referrer or url_for("seller_dashboard"))

        if g.user["role"] != "superuser" and sale["seller_id"] != g.user["id"]:
            flash("You do not have permission to edit this sale.", "error")
            return redirect(url_for("seller_dashboard"))

        buyer_name = request.form.get("buyer_name", "").strip()
        buyer_phone = request.form.get("buyer_phone", "").strip()
        if not buyer_name or not buyer_phone:
            flash("Buyer name and phone are required.", "error")
            return redirect(request.referrer or url_for("seller_dashboard"))

        db = get_db()
        db.execute(
            "UPDATE sales SET buyer_name = ?, buyer_phone = ? WHERE number = ?",
            (buyer_name, buyer_phone, number),
        )
        log_audit(
            "sale_edit",
            g.user["id"],
            number=number,
            seller_id=sale["seller_id"],
            details={
                "before": {
                    "buyer_name": sale["buyer_name"],
                    "buyer_phone": sale["buyer_phone"],
                },
                "after": {"buyer_name": buyer_name, "buyer_phone": buyer_phone},
            },
            db=db,
        )
        db.commit()
        flash("Sale updated.", "success")
        return redirect(request.referrer or url_for("seller_dashboard"))

    @app.route("/sale/<int:number>/void", methods=["POST"])
    @login_required
    def void_sale(number: int):
        sale = query_one(
            "SELECT number, seller_id, buyer_name, buyer_phone, sold_at FROM sales WHERE number = ?",
            (number,),
        )
        if not sale:
            flash("Sale not found.", "error")
            return redirect(request.referrer or url_for("seller_dashboard"))

        if g.user["role"] != "superuser" and sale["seller_id"] != g.user["id"]:
            flash("You do not have permission to void this sale.", "error")
            return redirect(url_for("seller_dashboard"))

        db = get_db()
        db.execute("DELETE FROM sales WHERE number = ?", (number,))
        log_audit(
            "sale_void",
            g.user["id"],
            number=number,
            seller_id=sale["seller_id"],
            details={
                "buyer_name": sale["buyer_name"],
                "buyer_phone": sale["buyer_phone"],
                "sold_at": sale["sold_at"],
            },
            db=db,
        )
        db.commit()
        flash("Sale voided and number released.", "success")
        return redirect(request.referrer or url_for("seller_dashboard"))

    @app.route("/reservation/<int:number>/release", methods=["POST"])
    @login_required
    def release_reservation(number: int):
        reservation = query_one(
            "SELECT number, seller_id, reserved_until FROM reservations WHERE number = ?",
            (number,),
        )
        if not reservation:
            flash("Reservation not found.", "error")
            return redirect(request.referrer or url_for("seller_dashboard"))

        if g.user["role"] != "superuser" and reservation["seller_id"] != g.user["id"]:
            flash("You do not have permission to release this reservation.", "error")
            return redirect(url_for("seller_dashboard"))

        db = get_db()
        db.execute("DELETE FROM reservations WHERE number = ?", (number,))
        log_audit(
            "reservation_release",
            g.user["id"],
            number=number,
            seller_id=reservation["seller_id"],
            details={"reserved_until": reservation["reserved_until"]},
            db=db,
        )
        db.commit()
        flash("Reservation released.", "success")
        return redirect(request.referrer or url_for("seller_dashboard"))

    @app.route("/admin")
    @superuser_required
    def admin_dashboard():
        cleanup_expired_reservations()

        total_sold = query_value("SELECT COUNT(*) FROM sales")
        total_reserved = query_value("SELECT COUNT(*) FROM reservations")
        total_remaining = MAX_NUMBER - total_sold - total_reserved

        seller_stats = query_all(
            "SELECT u.id, u.username, COUNT(s.id) AS sold_count "
            "FROM users u "
            "LEFT JOIN sales s ON s.seller_id = u.id "
            "WHERE u.role = 'seller' "
            "GROUP BY u.id "
            "ORDER BY sold_count DESC, u.username ASC"
        )

        recent_sales = query_all(
            "SELECT s.number, s.buyer_name, s.buyer_phone, s.sold_at, u.username AS seller_username "
            "FROM sales s "
            "JOIN users u ON u.id = s.seller_id "
            "ORDER BY s.sold_at DESC "
            "LIMIT 20"
        )

        recent_audit = query_all(
            "SELECT a.action, a.number, a.created_at, u.username AS actor_username "
            "FROM audit_log a "
            "LEFT JOIN users u ON u.id = a.actor_id "
            "ORDER BY a.created_at DESC "
            "LIMIT 20"
        )

        number_query = parse_int(request.args.get("number"), None)
        search_sale = None
        if number_query is not None:
            if 1 <= number_query <= MAX_NUMBER:
                sale = query_one(
                    "SELECT s.number, s.buyer_name, s.buyer_phone, s.sold_at, u.username AS seller_username, s.seller_id "
                    "FROM sales s JOIN users u ON u.id = s.seller_id WHERE s.number = ?",
                    (number_query,),
                )
                if sale:
                    search_sale = dict(sale)
                    search_sale["status"] = "sold"
                else:
                    reservation = query_one(
                        "SELECT r.number, r.reserved_until, u.username AS seller_username "
                        "FROM reservations r JOIN users u ON u.id = r.seller_id WHERE r.number = ?",
                        (number_query,),
                    )
                    if reservation:
                        search_sale = dict(reservation)
                        search_sale["status"] = "reserved"
                    else:
                        search_sale = {"number": number_query, "not_found": True}
            else:
                flash("Search number is out of range.", "error")

        return render_template(
            "admin_dashboard.html",
            total_sold=total_sold,
            total_reserved=total_reserved,
            total_remaining=total_remaining,
            seller_stats=seller_stats,
            recent_sales=recent_sales,
            recent_audit=recent_audit,
            search_sale=search_sale,
            max_number=MAX_NUMBER,
        )

    @app.route("/admin/sales/export")
    @superuser_required
    def export_sales():
        rows = query_all("SELECT number, buyer_name FROM sales ORDER BY number ASC")
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["number", "buyer_name"])
        for row in rows:
            writer.writerow([row["number"], row["buyer_name"]])

        response = make_response(output.getvalue())
        response.headers["Content-Type"] = "text/csv; charset=utf-8"
        response.headers["Content-Disposition"] = "attachment; filename=sales_export.csv"
        return response

    @app.route("/admin/users", methods=["GET", "POST"])
    @superuser_required
    def admin_users():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            error = None
            if not username or not password:
                error = "Username and password are required."
            elif len(password) < 6:
                error = "Password should be at least 6 characters."

            if error is None:
                db = get_db()
                try:
                    db.execute("BEGIN")
                    cursor = db.execute(
                        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
                        (
                            username,
                            generate_password_hash(password),
                            "seller",
                            now_ts(),
                        ),
                    )
                    seller_id = cursor.lastrowid
                    log_audit(
                        "seller_create",
                        g.user["id"],
                        seller_id=seller_id,
                        details={"username": username},
                        db=db,
                    )
                    db.commit()
                    flash(f"Seller '{username}' created.", "success")
                    return redirect(url_for("admin_users"))
                except sqlite3.IntegrityError:
                    db.rollback()
                    error = "Username already exists."
                except sqlite3.Error:
                    db.rollback()
                    error = "Database error. Please try again."

            if error:
                flash(error, "error")

        sellers = query_all(
            "SELECT u.id, u.username, u.created_at, "
            "(SELECT COUNT(*) FROM sales s WHERE s.seller_id = u.id) AS sold_count, "
            "(SELECT COUNT(*) FROM reservations r WHERE r.seller_id = u.id) AS reserved_count "
            "FROM users u WHERE u.role = 'seller' ORDER BY u.username"
        )
        return render_template("admin_users.html", sellers=sellers)

    @app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
    @superuser_required
    def delete_seller(user_id: int):
        seller = query_one(
            "SELECT id, username FROM users WHERE id = ? AND role = 'seller'",
            (user_id,),
        )
        if not seller:
            flash("Seller not found.", "error")
            return redirect(url_for("admin_users"))

        sold_count = query_value("SELECT COUNT(*) FROM sales WHERE seller_id = ?", (user_id,))
        reserved_count = query_value(
            "SELECT COUNT(*) FROM reservations WHERE seller_id = ?", (user_id,)
        )
        if sold_count or reserved_count:
            flash("Seller has sales or reservations and cannot be deleted.", "error")
            return redirect(url_for("admin_users"))

        db = get_db()
        try:
            db.execute("BEGIN")
            db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            log_audit(
                "seller_delete",
                g.user["id"],
                seller_id=user_id,
                details={"username": seller["username"]},
                db=db,
            )
            db.commit()
            flash(f"Seller '{seller['username']}' deleted.", "success")
        except sqlite3.Error:
            db.rollback()
            flash("Database error. Please try again.", "error")
        return redirect(url_for("admin_users"))

    @app.route("/admin/audit")
    @superuser_required
    def admin_audit():
        action = request.args.get("action", "").strip()
        actor = request.args.get("actor", "").strip()
        seller = request.args.get("seller", "").strip()
        number = parse_int(request.args.get("number"), None)
        date_from_raw = request.args.get("date_from", "").strip()
        date_to_raw = request.args.get("date_to", "").strip()

        if number is not None and (number < 1 or number > MAX_NUMBER):
            flash("Number is out of range.", "error")
            number = None

        date_from = normalize_date_input(date_from_raw, end=False)
        date_to = normalize_date_input(date_to_raw, end=True)

        clauses = []
        params = []

        if action:
            clauses.append("a.action = ?")
            params.append(action)
        if number is not None:
            clauses.append("a.number = ?")
            params.append(number)
        if actor:
            clauses.append("actor.username = ?")
            params.append(actor)
        if seller:
            clauses.append("seller.username = ?")
            params.append(seller)
        if date_from:
            clauses.append("a.created_at >= ?")
            params.append(date_from)
        if date_to:
            clauses.append("a.created_at <= ?")
            params.append(date_to)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        total = query_value(
            "SELECT COUNT(*) FROM audit_log a "
            "LEFT JOIN users actor ON actor.id = a.actor_id "
            "LEFT JOIN users seller ON seller.id = a.seller_id "
            f"{where_sql}",
            tuple(params),
        )

        page = parse_int(request.args.get("page"), 1)
        page_size = 100
        page_count = max(1, (total + page_size - 1) // page_size)
        page = max(1, min(page, page_count))
        offset = (page - 1) * page_size

        rows = query_all(
            "SELECT a.action, a.number, a.created_at, a.details, "
            "actor.username AS actor_username, seller.username AS seller_username "
            "FROM audit_log a "
            "LEFT JOIN users actor ON actor.id = a.actor_id "
            "LEFT JOIN users seller ON seller.id = a.seller_id "
            f"{where_sql} "
            "ORDER BY a.created_at DESC "
            "LIMIT ? OFFSET ?",
            tuple(params + [page_size, offset]),
        )

        actions = query_all("SELECT DISTINCT action FROM audit_log ORDER BY action")
        users = query_all("SELECT username FROM users ORDER BY username")
        filters = {
            "action": action or "",
            "actor": actor or "",
            "seller": seller or "",
            "number": number or "",
            "date_from": date_from_raw or "",
            "date_to": date_to_raw or "",
        }
        filters = {key: value for key, value in filters.items() if value != ""}

        return render_template(
            "admin_audit.html",
            rows=rows,
            actions=actions,
            users=users,
            action=action,
            actor=actor,
            seller=seller,
            number=number,
            date_from=date_from_raw,
            date_to=date_to_raw,
            total=total,
            page=page,
            page_count=page_count,
            filters=filters,
            max_number=MAX_NUMBER,
        )

    app.teardown_appcontext(close_db)

    return app


# Database helpers

def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(exception) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = sqlite3.connect(current_app.config["DATABASE"])
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('seller', 'superuser')),
            created_at TEXT NOT NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number INTEGER NOT NULL UNIQUE,
            seller_id INTEGER NOT NULL,
            buyer_name TEXT NOT NULL,
            buyer_phone TEXT NOT NULL,
            sold_at TEXT NOT NULL,
            FOREIGN KEY (seller_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number INTEGER NOT NULL UNIQUE,
            seller_id INTEGER NOT NULL,
            reserved_at TEXT NOT NULL,
            reserved_until TEXT NOT NULL,
            FOREIGN KEY (seller_id) REFERENCES users(id)
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            actor_id INTEGER NOT NULL,
            number INTEGER,
            seller_id INTEGER,
            details TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (actor_id) REFERENCES users(id)
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_sales_seller ON sales(seller_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_reservations_until ON reservations(reserved_until)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)")
    db.commit()
    db.close()


def bootstrap_superuser() -> None:
    username = (
        os.environ.get("SUPERUSER_USERNAME")
        or os.environ.get("SUPERUSER_USENAME")
        or DEFAULT_SUPERUSER_USERNAME
    )
    password = os.environ.get("SUPERUSER_PASSWORD") or DEFAULT_SUPERUSER_PASSWORD
    if not username or not password:
        return

    existing = query_value("SELECT COUNT(*) FROM users WHERE role = 'superuser'")
    if existing:
        return

    execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
        (
            username,
            generate_password_hash(password),
            "superuser",
            now_ts(),
        ),
    )


def cleanup_expired_reservations() -> None:
    now = now_ts()
    db = get_db()
    expired = db.execute(
        "SELECT id, number, seller_id, reserved_until FROM reservations WHERE reserved_until < ?",
        (now,),
    ).fetchall()
    if not expired:
        return

    db.execute("BEGIN")
    for row in expired:
        log_audit(
            "reservation_expired",
            row["seller_id"],
            number=row["number"],
            seller_id=row["seller_id"],
            details={"reserved_until": row["reserved_until"]},
            db=db,
        )
    db.executemany("DELETE FROM reservations WHERE id = ?", [(row["id"],) for row in expired])
    db.commit()


# Query helpers

def query_one(query: str, params: tuple | None = None):
    db = get_db()
    cur = db.execute(query, params or ())
    row = cur.fetchone()
    cur.close()
    return row


def query_all(query: str, params: tuple | None = None):
    db = get_db()
    cur = db.execute(query, params or ())
    rows = cur.fetchall()
    cur.close()
    return rows


def query_value(query: str, params: tuple | None = None):
    row = query_one(query, params)
    if row is None:
        return 0
    return list(row)[0]


def execute(query: str, params: tuple | None = None) -> None:
    db = get_db()
    db.execute(query, params or ())
    db.commit()


def log_audit(
    action: str,
    actor_id: int,
    number: int | None = None,
    seller_id: int | None = None,
    details: dict | None = None,
    db: sqlite3.Connection | None = None,
) -> None:
    payload = json.dumps(details) if details is not None else None
    conn = db or get_db()
    conn.execute(
        "INSERT INTO audit_log (action, actor_id, number, seller_id, details, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (action, actor_id, number, seller_id, payload, now_ts()),
    )


def parse_int(value, default):
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_date_input(value: str, end: bool) -> str:
    if not value:
        return ""
    if len(value) == 10:
        return f"{value}T23:59:59" if end else f"{value}T00:00:00"
    return value


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
