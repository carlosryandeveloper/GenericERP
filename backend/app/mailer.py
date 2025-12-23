import os
import smtplib
from email.message import EmailMessage


def send_email(to_email: str, subject: str, text: str) -> bool:
    """
    ENV esperadas (opcionais):
      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
      SMTP_TLS=true/false  (default true)
    Se SMTP_HOST não existir -> imprime no console e retorna True.
    """
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        print("\n--- EMAIL (DEV) ---")
        print("TO:", to_email)
        print("SUBJECT:", subject)
        print(text)
        print("--- /EMAIL (DEV) ---\n")
        return True

    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASS", "").strip()
    from_email = os.getenv("SMTP_FROM", user or "no-reply@genericerp.local")
    use_tls = os.getenv("SMTP_TLS", "true").lower() != "false"

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)

    try:
        with smtplib.SMTP(host, port, timeout=20) as server:
            if use_tls:
                server.starttls()
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        return True
    except Exception as e:
        print("Erro ao enviar e-mail:", e)
        return False
