"""
scheduler.py — Atualiza os dados do Instagram todo dia às 8h (horário de Brasília).

Como usar:
  pip install schedule python-dotenv
  python scheduler.py

Deixe rodando em segundo plano. Enquanto estiver rodando,
os dados serão atualizados automaticamente todo dia às 8h.
"""

import schedule
import time
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")


def run_fetch():
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    print(f"\n⏰ [{now}] Iniciando atualização diária...")
    result = subprocess.run([sys.executable, "fetch_instagram.py"], capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr)
    print(f"✅ [{now}] Atualização concluída.")


# Executa imediatamente ao iniciar, depois todo dia às 8h
run_fetch()
schedule.every().day.at("08:00").do(run_fetch)

print("\n📅 Scheduler ativo — próxima execução às 08:00. Ctrl+C para parar.\n")

while True:
    schedule.run_pending()
    time.sleep(60)
