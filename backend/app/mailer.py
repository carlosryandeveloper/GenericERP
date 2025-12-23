from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage


def send_email(to_email: str, subject: str, body: str) -> bool:
    """
    Envia e-mail via SMTP.
    Configure as variáveis de ambiente:
      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (opcional),
      SMTP_TLS=true/false, SMTP_SSL=true/false
    """
    host = (os.getenv("SMTP_HOST") or "").strip()
    if not host:
        # modo DEV: sem SMTP configurado
        print("[MAILER] SMTP_HOST não definido. E-mail não enviado.")
        print("[MAILER] Para:", to_email)
        print("[MAILER] Assunto:", subject)
        print("[MAILER] Corpo:\n", body)
        return False

    port = int(os.getenv("SMTP_PORT") or "587")
    user = (os.getenv("SMTP_USER") or "").strip()
    password = (os.getenv("SMTP_PASS") or "").strip()
    from_email = (os.getenv("SMTP_FROM") or user or "no-reply@genericerp.local").strip()

    use_tls = (os.getenv("SMTP_TLS") or "true").strip().lower() in ("1", "true", "yes", "y")
    use_ssl = (os.getenv("SMTP_SSL") or "false").strip().lower() in ("1", "true", "yes", "y")

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=20)
        else:
            server = smtplib.SMTP(host, port, timeout=20)

        with server:
            if use_tls and not use_ssl:
                server.starttls()

            if user and password:
                server.login(user, password)

            server.send_message(msg)

        return True
    except Exception as e:
        print("[MAILER] Falha ao enviar e-mail:", repr(e))
        return False
