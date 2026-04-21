"""
parse_csv.py — Converte o CSV exportado do Meta Business Suite
em data/suno.json e data/tiagogreis.json para o dashboard.

Uso:
  python3 parse_csv.py arquivo.csv
  python3 parse_csv.py  (usa o CSV mais recente da pasta)
"""

import csv
import json
import re
import sys
import glob
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

ACCOUNTS_CONFIG = {
    "suno":            {"name": "Suno Investimentos",         "followers": 717174},
    "tiagogreis":      {"name": "Tiago Reis | Investimentos", "followers": 1689944},
    "fundsexplorer":   {"name": "Funds Explorer",             "followers": 216651},
    "fiis.com.br":     {"name": "FIIS.com.br",                "followers": 450781},
    "sunonoticias":    {"name": "Suno Notícias",              "followers": 420119},
    "status.invest":   {"name": "Status Invest",              "followers": 345336},
    "professorbaroni": {"name": "Professor Baroni",           "followers": 365890},
    "sunoasset":       {"name": "Suno Asset",                 "followers": 62615},
}

TYPE_MAP = {
    "Reel do Instagram":      "REEL",
    "Carrossel do Instagram": "CAROUSEL",
    "Imagem do Instagram":    "IMAGE",
}

MONTH_PT = {
    1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr",
    5: "Mai", 6: "Jun", 7: "Jul", 8: "Ago",
    9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
}


def parse_date(s):
    for fmt in ("%m/%d/%Y %H:%M", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            pass
    return None


def load_csv(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def num(s):
    try:
        return int(s.replace(",", "").strip())
    except (ValueError, AttributeError):
        return 0


def deduplicate(rows):
    seen = {}
    for r in rows:
        pid = r["Identificação do post"]
        if pid not in seen:
            seen[pid] = r
    return list(seen.values())


def build_posts(rows):
    posts = []
    for r in rows:
        dt = parse_date(r.get("Horário de publicação", ""))
        reach    = num(r["Alcance"])
        views    = num(r["Visualizações"])
        likes    = num(r["Curtidas"])
        comments = num(r["Comentários"])
        shares   = num(r["Compartilhamentos"])
        saves    = num(r["Salvamentos"])
        follows  = num(r["Seguimentos"])
        engagement = likes + comments + shares + saves
        eng_rate   = round(engagement / max(reach, 1) * 100, 2)

        posts.append({
            "id":              r["Identificação do post"],
            "date":            dt.strftime("%Y-%m-%d") if dt else "",
            "datetime":        r.get("Horário de publicação", ""),
            "type":            TYPE_MAP.get(r.get("Tipo de post", ""), "IMAGE"),
            "caption":         (r.get("Descrição") or "").replace("\n", " ").strip()[:200],
            "permalink":       r.get("Link permanente", ""),
            "views":           views,
            "reach":           reach,
            "likes":           likes,
            "comments":        comments,
            "shares":          shares,
            "saves":           saves,
            "follows":         follows,
            "engagement":      engagement,
            "engagement_rate": eng_rate,
        })

    posts.sort(key=lambda p: p["date"], reverse=True)
    return posts


def build_daily(posts):
    daily = defaultdict(lambda: {"reach": 0, "views": 0, "engagement": 0, "follows": 0, "posts": 0})
    for p in posts:
        if not p["date"]:
            continue
        d = daily[p["date"]]
        d["date"]       = p["date"]
        d["reach"]      += p["reach"]
        d["views"]      += p["views"]
        d["engagement"] += p["engagement"]
        d["follows"]    += p["follows"]
        d["posts"]      += 1
    result = sorted(daily.values(), key=lambda d: d["date"])
    for d in result:
        d["eng_rate"] = round(d["engagement"] / max(d["reach"], 1) * 100, 2)
    return result


def build_monthly(posts):
    monthly = defaultdict(lambda: {
        "reach": 0, "views": 0, "engagement": 0,
        "posts": 0, "likes": 0, "comments": 0,
        "shares": 0, "saves": 0,
    })

    for p in posts:
        if not p["date"]:
            continue
        dt = datetime.strptime(p["date"], "%Y-%m-%d")
        key = f"{MONTH_PT[dt.month]}/{str(dt.year)[2:]}"
        m = monthly[key]
        m["month"]      = key
        m["reach"]      += p["reach"]
        m["views"]      += p["views"]
        m["engagement"] += p["engagement"]
        m["likes"]      += p["likes"]
        m["comments"]   += p["comments"]
        m["shares"]     += p["shares"]
        m["saves"]      += p["saves"]
        m["posts"]      += 1

    month_order = list(MONTH_PT.values())
    ordered_keys = sorted(monthly.keys(), key=lambda k: (int("20" + k.split("/")[1]), month_order.index(k.split("/")[0])))
    return [monthly[k] for k in ordered_keys]


def build_summary(posts, period_start, period_end):
    total_reach      = sum(p["reach"] for p in posts)
    total_views      = sum(p["views"] for p in posts)
    total_likes      = sum(p["likes"] for p in posts)
    total_comments   = sum(p["comments"] for p in posts)
    total_shares     = sum(p["shares"] for p in posts)
    total_saves      = sum(p["saves"] for p in posts)
    total_engagement = total_likes + total_comments + total_shares + total_saves
    total_posts      = len(posts)
    avg_reach        = round(total_reach / max(total_posts, 1))
    avg_engagement   = round(total_engagement / max(total_posts, 1))
    avg_eng_rate     = round(sum(p["engagement_rate"] for p in posts) / max(total_posts, 1), 2)

    total_follows = sum(p["follows"] for p in posts)

    return {
        "period":             f"{period_start} a {period_end}",
        "total_reach":        total_reach,
        "total_views":        total_views,
        "total_likes":        total_likes,
        "total_comments":     total_comments,
        "total_shares":       total_shares,
        "total_saves":        total_saves,
        "total_follows":      total_follows,
        "total_engagement":   total_engagement,
        "avg_engagement_rate": avg_eng_rate,
        "avg_reach_per_post": avg_reach,
        "avg_engagement_per_post": avg_engagement,
        "total_posts":        total_posts,
    }


def cap(text, n=70):  # kept for generate_insights compatibility
    return (text[:n] + "…") if len(text) > n else text


def generate_insights(posts, monthly):
    insights = []
    type_names = {"CAROUSEL": "Carrossel", "REEL": "Reel", "IMAGE": "Imagem estática"}

    # Best format by avg reach
    by_type = defaultdict(list)
    for p in posts:
        by_type[p["type"]].append(p["reach"])
    avg_by_type = {t: sum(v)/len(v) for t, v in by_type.items() if v}
    if avg_by_type:
        best_type  = max(avg_by_type, key=avg_by_type.get)
        worst_type = min(avg_by_type, key=avg_by_type.get)
        diff_pct   = round((avg_by_type[best_type] - avg_by_type[worst_type]) / max(avg_by_type[worst_type], 1) * 100)
        insights.append({
            "type": "top", "icon": "🏆",
            "title": f"{type_names.get(best_type, best_type)} é o formato campeão",
            "body": f"Alcance médio {diff_pct}% maior que {type_names.get(worst_type, worst_type).lower()}. "
                    f"Média de {avg_by_type[best_type]:,.0f} pessoas alcançadas por post.",
        })

    # Best month
    if monthly:
        best_month = max(monthly, key=lambda m: m["reach"])
        insights.append({
            "type": "top", "icon": "📈",
            "title": f"{best_month['month']} foi o mês de maior alcance",
            "body": f"{best_month['reach']:,} pessoas alcançadas em {best_month['posts']} posts — "
                    f"média de {best_month['reach']//max(best_month['posts'],1):,} por post.",
        })

    # Top by saves
    top_saves = sorted(posts, key=lambda p: p["saves"], reverse=True)[:1]
    if top_saves:
        p = top_saves[0]
        insights.append({
            "type": "action", "icon": "🔖",
            "title": "Post mais salvo do período",
            "body": f"\"{cap(p['caption'])}\" — {p['saves']:,} salvamentos. "
                    "Alta taxa de save = conteúdo de referência. Produza mais desse tema.",
            "permalink": p["permalink"], "metric": f"{p['saves']:,} saves",
        })

    # Top by shares
    top_shared = sorted(posts, key=lambda p: p["shares"], reverse=True)[:1]
    if top_shared:
        p = top_shared[0]
        insights.append({
            "type": "action", "icon": "🔁",
            "title": "Post mais compartilhado",
            "body": f"\"{cap(p['caption'])}\" — {p['shares']:,} compartilhamentos em {p['date']}. "
                    "Compartilhamentos orgânicos são o principal motor de alcance viral.",
            "permalink": p["permalink"], "metric": f"{p['shares']:,} shares",
        })

    # Top by engagement rate (min 1000 reach to filter noise)
    meaningful = [p for p in posts if p["reach"] >= 1000]
    if meaningful:
        top_eng = sorted(meaningful, key=lambda p: p["engagement_rate"], reverse=True)[0]
        insights.append({
            "type": "top", "icon": "🎯",
            "title": "Maior taxa de engajamento",
            "body": f"\"{cap(top_eng['caption'])}\" — {top_eng['engagement_rate']:.2f}% de taxa de engajamento "
                    f"com {top_eng['reach']:,} de alcance. Analise o tema e replique.",
            "permalink": top_eng["permalink"], "metric": f"{top_eng['engagement_rate']:.2f}% engaj.",
        })

    # Top by reach
    top_reach = sorted(posts, key=lambda p: p["reach"], reverse=True)[0] if posts else None
    if top_reach:
        insights.append({
            "type": "top", "icon": "👁️",
            "title": "Post de maior alcance",
            "body": f"\"{cap(top_reach['caption'])}\" — {top_reach['reach']:,} pessoas alcançadas "
                    f"({type_names.get(top_reach['type'], top_reach['type'])}, {top_reach['date']}).",
            "permalink": top_reach["permalink"], "metric": f"{top_reach['reach']:,} alcance",
        })

    # Low engagement alert
    low_eng = [p for p in posts if p["engagement_rate"] < 1.0 and p["reach"] >= 5000]
    if low_eng:
        insights.append({
            "type": "alert", "icon": "⚠️",
            "title": f"{len(low_eng)} posts com engajamento abaixo de 1%",
            "body": f"Posts com alto alcance mas baixo engajamento podem indicar conteúdo pouco relevante "
                    "ou público fora do perfil. Revise o CTA e a segmentação desses conteúdos.",
        })

    return insights


def shortcode_from_url(url):
    m = re.search(r'instagram\.com/(?:p|reel)/([A-Za-z0-9_-]+)', url or '')
    return m.group(1) if m else None


def generate_daily_insights(daily, posts):
    """Insights acionáveis para os últimos 7 dias."""
    if not daily:
        return []

    insights = []
    last7   = daily[-7:]
    prev7   = daily[-14:-7] if len(daily) >= 14 else []

    avg_reach_last7 = sum(d["reach"] for d in last7) / max(len(last7), 1)
    avg_reach_prev7 = sum(d["reach"] for d in prev7) / max(len(prev7), 1) if prev7 else avg_reach_last7

    trend_pct = round((avg_reach_last7 - avg_reach_prev7) / max(avg_reach_prev7, 1) * 100, 1)
    trend_dir = "alta" if trend_pct >= 0 else "queda"
    trend_icon = "📈" if trend_pct >= 0 else "📉"
    insights.append({
        "icon": trend_icon,
        "type": "top" if trend_pct >= 0 else "alert",
        "title": f"Alcance dos últimos 7 dias em {trend_dir} de {abs(trend_pct)}%",
        "body": f"Média diária: {avg_reach_last7:,.0f} contas alcançadas vs {avg_reach_prev7:,.0f} nos 7 dias anteriores.",
    })

    # Best day in last 7
    best_day = max(last7, key=lambda d: d["reach"])
    best_date = datetime.strptime(best_day["date"], "%Y-%m-%d").strftime("%d/%m")
    insights.append({
        "icon": "🏆",
        "type": "top",
        "title": f"{best_date} foi o melhor dia da semana",
        "body": f"{best_day['reach']:,} de alcance em {best_day['posts']} post(s). "
                f"Estude o que foi publicado nesse dia e replique.",
    })

    # Posting frequency last 7 days
    posts_last7 = sum(d["posts"] for d in last7)
    avg_per_day = round(posts_last7 / 7, 1)
    insights.append({
        "icon": "📅",
        "type": "action",
        "title": f"Frequência: {posts_last7} posts em 7 dias ({avg_per_day}/dia)",
        "body": "Consistência é o principal fator de crescimento orgânico. "
                f"{'Ótima cadência — mantenha!' if avg_per_day >= 1 else 'Abaixo de 1 por dia. Aumente a frequência para acelerar o crescimento.'}",
    })

    # Engagement vs reach ratio last 7
    avg_eng_last7 = sum(d["engagement"] for d in last7) / max(sum(d["reach"] for d in last7), 1) * 100
    avg_eng_full  = sum(d["engagement"] for d in daily) / max(sum(d["reach"] for d in daily), 1) * 100
    eng_trend = avg_eng_last7 - avg_eng_full
    insights.append({
        "icon": "💬",
        "type": "top" if eng_trend >= 0 else "alert",
        "title": f"Taxa de engajamento nos últimos 7 dias: {avg_eng_last7:.2f}%",
        "body": f"{'Acima' if eng_trend >= 0 else 'Abaixo'} da média do período ({avg_eng_full:.2f}%) em "
                f"{abs(eng_trend):.2f} pontos percentuais.",
    })

    # Best post of last 7 days
    cutoff = (datetime.today() - timedelta(days=7)).strftime("%Y-%m-%d")
    recent_posts = [p for p in posts if p["date"] >= cutoff]
    if recent_posts:
        best = max(recent_posts, key=lambda p: p["reach"])
        cap  = cap_fn(best["caption"], 70)
        insights.append({
            "icon": "⭐",
            "type": "action",
            "title": "Post de destaque dos últimos 7 dias",
            "body": f"\"{cap}\" — {best['reach']:,} de alcance, {best['engagement_rate']:.2f}% de engajamento.",
            "permalink": best["permalink"],
            "shortcode": shortcode_from_url(best["permalink"]),
        })

    return insights


def analyze_copywriting(posts):
    """Analisa padrões de copywriting dos top posts vs bottom posts."""
    if len(posts) < 10:
        return []

    top_n    = max(5, len(posts) // 4)
    by_reach = sorted(posts, key=lambda p: p["reach"], reverse=True)
    top      = by_reach[:top_n]
    bottom   = by_reach[-top_n:]
    carousels = [p for p in posts if p["type"] == "CAROUSEL"]
    top_carousels = sorted(carousels, key=lambda p: p["reach"], reverse=True)[:max(3, len(carousels)//4)]

    def first_line(text):
        return (text or '').strip().split('\n')[0].strip()

    def avg_len(lst):
        return round(sum(len(p["caption"]) for p in lst) / max(len(lst), 1))

    def emoji_count(text):
        return len(re.findall(r'[^\w\s,.:;!?\-()\[\]{}\'"@#/\\]', text or ''))

    def has_cta(text):
        t = (text or '').lower()
        return any(kw in t for kw in ['link na bio', 'comente', 'salva', 'compartilha', 'siga', 'clique', 'acesse', 'baixe', 'comenta', 'me conta'])

    def hook_type(text):
        line = first_line(text)
        if not line:
            return 'vazio'
        if line.endswith('?') or re.search(r'\bvocê\b|\bsabia\b|\bsabe\b', line, re.I):
            return 'pergunta'
        if re.match(r'^\d', line):
            return 'número/dado'
        imperatives = r'^(aprenda|descubra|veja|entenda|saiba|faça|use|invista|calcule|conheça|pare|evite|nunca|sempre|como )'
        if re.match(imperatives, line, re.I):
            return 'comando'
        if re.match(r'^["""«]', line):
            return 'citação'
        return 'afirmação'

    def has_numbered_list(text):
        return bool(re.search(r'(^|\n)\d[\.\)]\s', text or ''))

    def has_line_breaks(text):
        return (text or '').count('\n') >= 2

    STOPWORDS = {
        'sobre', 'como', 'para', 'mais', 'você', 'esse', 'essa', 'seus', 'suas',
        'nosso', 'nossos', 'nossas', 'que', 'com', 'por', 'uma', 'não', 'mas',
        'são', 'está', 'ser', 'ter', 'nos', 'foi', 'pelo', 'pela', 'dos', 'das',
        'isso', 'este', 'esta', 'tem', 'também', 'quando', 'cada', 'qual', 'todo',
        'numa', 'num', 'aqui', 'onde', 'quem', 'muito', 'ainda', 'então', 'entre',
    }

    insights = []

    # 1. Hook style — abertura dos top posts
    hook_counts = Counter(hook_type(p["caption"]) for p in top)
    dominant_hook, hook_freq = hook_counts.most_common(1)[0]
    hook_pct = round(hook_freq / max(len(top), 1) * 100)
    hook_tips = {
        'pergunta':    'Perguntas ativam curiosidade e aumentam comentários. Ex: "Você sabia que…?" ou "Qual desses erros você comete?"',
        'número/dado': 'Números criam especificidade e credibilidade. Ex: "3 erros que destroem sua carteira" ou "R$1.000/mês em dividendos é possível?"',
        'comando':     'Imperativos geram ação imediata. Ex: "Aprenda a calcular o DY em 30 segundos" ou "Pare de ignorar esse indicador".',
        'citação':     'Citações ou frases de impacto entre aspas chamam atenção no feed.',
        'afirmação':   'Afirmações diretas funcionam quando a premissa é forte e contraintuitiva.',
    }
    insights.append({
        "icon": "🪝",
        "type": "top",
        "title": f"Hook dominante nos top posts: {dominant_hook} ({hook_pct}%)",
        "body": hook_tips.get(dominant_hook, f"{hook_pct}% dos posts de maior alcance abrem com {dominant_hook}."),
    })

    # 2. Comprimento de legenda
    top_len = avg_len(top)
    bot_len = avg_len(bottom)
    shorter = top_len < bot_len
    insights.append({
        "icon": "✍️",
        "type": "action",
        "title": f"Legendas {'curtas' if shorter else 'longas'} performam melhor ({top_len} vs {bot_len} chars)",
        "body": (
            f"Top posts usam em média {top_len} caracteres — {bot_len - top_len} a menos que os bottom posts. "
            "Vá direto ao ponto: primeira linha forte + CTA no final."
            if shorter else
            f"Top posts usam em média {top_len} caracteres — {top_len - bot_len} a mais que os bottom posts. "
            "Legendas mais completas entregam mais contexto e mantêm o leitor engajado."
        ),
    })

    # 3. Estrutura com quebras de linha e parágrafos
    top_breaks = round(sum(1 for p in top if has_line_breaks(p["caption"])) / max(len(top), 1) * 100)
    bot_breaks = round(sum(1 for p in bottom if has_line_breaks(p["caption"])) / max(len(bottom), 1) * 100)
    insights.append({
        "icon": "📐",
        "type": "action" if top_breaks > bot_breaks else "alert",
        "title": f"Formatação com parágrafos: {top_breaks}% dos top posts vs {bot_breaks}% dos bottom",
        "body": (
            "Posts com quebras de linha e parágrafos curtos são mais fáceis de ler no mobile. "
            "Use espaçamento para separar o hook, o desenvolvimento e o CTA."
            if top_breaks >= bot_breaks else
            "Curiosamente, os bottom posts usam mais quebras de linha. "
            "Tente legendas mais densas e diretas para esse público."
        ),
    })

    # 4. Listas numeradas — especialmente em carrosséis
    top_numbered = round(sum(1 for p in top if has_numbered_list(p["caption"])) / max(len(top), 1) * 100)
    if carousels:
        car_numbered = round(sum(1 for p in top_carousels if has_numbered_list(p["caption"])) / max(len(top_carousels), 1) * 100)
        insights.append({
            "icon": "📋",
            "type": "action",
            "title": f"Listas numeradas: {top_numbered}% dos top posts (carrosséis: {car_numbered}%)",
            "body": (
                "Listas numeradas na legenda reforçam a estrutura do carrossel e deixam claro quantos slides o seguidor vai consumir. "
                "Ex: '5 erros que todo iniciante comete:' seguido de '1. …\\n2. …' nos slides."
                if top_numbered >= 20 else
                "Poucos top posts usam listas numeradas na legenda. Teste estruturas como '3 razões para…' ou 'Passo a passo:' para carrosséis educativos."
            ),
        })

    # 5. CTA explícito
    top_cta    = round(sum(1 for p in top if has_cta(p["caption"])) / max(len(top), 1) * 100)
    bot_cta    = round(sum(1 for p in bottom if has_cta(p["caption"])) / max(len(bottom), 1) * 100)
    cta_examples = ['Salva esse post', 'Comenta aqui', 'Link na bio', 'Me conta nos comentários', 'Compartilha com quem precisa']
    quoted_ctas = ', '.join(f'"{c}"' for c in cta_examples[:3])
    insights.append({
        "icon": "🎯",
        "type": "action" if top_cta > bot_cta else "alert",
        "title": f"CTA explícito em {top_cta}% dos top posts vs {bot_cta}% dos bottom",
        "body": f"Chamadas para ação aumentam engajamento e salvamentos. "
                f"Prefira CTAs específicos ao contexto: {quoted_ctas}. "
                f"Posicione sempre na última linha da legenda.",
    })

    # 6. Tom: pergunta como gancho de comentário
    top_q  = round(sum(1 for p in top if '?' in (p["caption"] or '')) / max(len(top), 1) * 100)
    bot_q  = round(sum(1 for p in bottom if '?' in (p["caption"] or '')) / max(len(bottom), 1) * 100)
    insights.append({
        "icon": "💬",
        "type": "top" if top_q > bot_q else "action",
        "title": f"Perguntas na legenda: {top_q}% dos top posts vs {bot_q}% dos bottom",
        "body": (
            "Posts que fazem perguntas geram mais comentários, o que sinaliza relevância pro algoritmo. "
            "Use perguntas retóricas no hook ('Você ainda faz isso?') ou diretas no CTA ('Qual é sua estratégia?')."
        ),
    })

    # 8. Carrossel: comprimento de legenda específico
    if len(top_carousels) >= 3:
        car_len = round(sum(len(p["caption"]) for p in top_carousels) / len(top_carousels))
        insights.append({
            "icon": "🎠",
            "type": "action",
            "title": f"Carrosséis de alto alcance: legenda média de {car_len} caracteres",
            "body": (
                "Para carrosséis, a legenda ideal funciona como 'trailer': apresenta o problema ou promessa no hook, "
                "lista o que o seguidor vai aprender nos slides e fecha com CTA de salvamento. "
                "Evite repetir nos comentários o que já está nos slides."
            ),
        })

    return insights


def analyze_posting_times(posts, stories=None):
    """Insights sobre melhores horários e dias para posts e stories."""
    DAYS_PT = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
    insights = []

    def best_times(items, reach_key="reach"):
        by_hour    = defaultdict(list)
        by_weekday = defaultdict(list)
        for item in items:
            raw = item.get("datetime", "")
            dt  = parse_date(raw)
            if not dt:
                continue
            by_hour[dt.hour].append(item[reach_key])
            by_weekday[dt.weekday()].append(item[reach_key])
        avg_hour    = {h: sum(v)/len(v) for h, v in by_hour.items()    if len(v) >= 2}
        avg_weekday = {d: sum(v)/len(v) for d, v in by_weekday.items() if len(v) >= 2}
        return avg_hour, avg_weekday

    # ── Feed posts ────────────────────────────────────────────────────
    if posts:
        avg_hour, avg_weekday = best_times(posts)
        if avg_hour:
            top_hours = sorted(avg_hour, key=avg_hour.get, reverse=True)[:3]
            hour_strs = [f"{h:02d}h–{h+1:02d}h" for h in top_hours]
            worst_hour = min(avg_hour, key=avg_hour.get)
            insights.append({
                "icon": "🕐",
                "type": "action",
                "title": f"Melhores horários para postar (feed): {', '.join(hour_strs)}",
                "body": (
                    f"Posts publicados entre {hour_strs[0]} alcançam em média "
                    f"{avg_hour[top_hours[0]]:,.0f} pessoas — o maior alcance do período. "
                    f"Evite publicar às {worst_hour:02d}h, que registra o menor desempenho."
                ),
            })
        if avg_weekday:
            top_days = sorted(avg_weekday, key=avg_weekday.get, reverse=True)[:2]
            day_strs = [DAYS_PT[d] for d in top_days]
            worst_day = DAYS_PT[min(avg_weekday, key=avg_weekday.get)]
            insights.append({
                "icon": "📅",
                "type": "action",
                "title": f"Melhores dias para postar (feed): {' e '.join(day_strs)}",
                "body": (
                    f"{day_strs[0]} e {day_strs[1]} concentram os maiores alcances do período. "
                    f"Evite {worst_day} para posts estratégicos — o alcance médio é significativamente menor."
                ),
            })

    # ── Stories ───────────────────────────────────────────────────────
    if stories:
        avg_hour_s, avg_weekday_s = best_times(stories)
        if avg_hour_s:
            top_hours_s = sorted(avg_hour_s, key=avg_hour_s.get, reverse=True)[:3]
            hour_strs_s = [f"{h:02d}h–{h+1:02d}h" for h in top_hours_s]
            insights.append({
                "icon": "📖",
                "type": "action",
                "title": f"Melhores horários para stories: {', '.join(hour_strs_s)}",
                "body": (
                    f"Stories publicados entre {hour_strs_s[0]} têm o maior alcance médio do período. "
                    "Stories têm vida útil de 24h — publicar nos picos de audiência maximiza a visualização."
                ),
            })
        if avg_weekday_s:
            top_days_s = sorted(avg_weekday_s, key=avg_weekday_s.get, reverse=True)[:2]
            day_strs_s = [DAYS_PT[d] for d in top_days_s]
            insights.append({
                "icon": "📅",
                "type": "action",
                "title": f"Melhores dias para stories: {' e '.join(day_strs_s)}",
                "body": (
                    f"Stories postados em {day_strs_s[0]} e {day_strs_s[1]} alcançam mais pessoas. "
                    "Use esses dias para stories de alto valor: bastidores, ofertas, links estratégicos."
                ),
            })

    return insights


def cap_fn(text, n=70):
    return (text[:n] + "…") if len(text) > n else text


def build_top_posts(posts):
    """Top 5 por cada métrica para o painel de top posts."""
    KEYS = ("id","date","type","caption","permalink","shortcode","reach","views","likes","comments","shares","saves","follows","engagement","engagement_rate")
    def top5(key):
        return [
            {k: p.get(k) for k in KEYS}
            for p in sorted(posts, key=lambda p: p[key], reverse=True)[:5]
        ]
    return {
        "by_reach":           top5("reach"),
        "by_engagement_rate": top5("engagement_rate"),
        "by_shares":          top5("shares"),
        "by_saves":           top5("saves"),
        "by_views":           top5("views"),
        "by_follows":         top5("follows"),
    }


def build_stories(story_rows, username):
    """Processa stories de uma conta."""
    rows = deduplicate([r for r in story_rows if r["Nome de usuário da conta"] == username])
    stories = []
    for r in rows:
        dt = parse_date(r.get("Horário de publicação", ""))
        reach     = num(r.get("Alcance", 0))
        # Meta exports stories views under English "Views" column, not "Visualizações"
        views     = num(r.get("Views") or r.get("Visualizações", 0))
        replies   = num(r.get("Respostas", 0))
        # Profile visits use English column in stories export
        visits    = num(r.get("Profile visits") or r.get("Visitas ao perfil", 0))
        link_clicks = num(r.get("Cliques no link", 0))
        nav       = num(r.get("Navegação", 0))
        stickers  = num(r.get("Toques em figurinhas", 0))
        stories.append({
            "id":          r["Identificação do post"],
            "date":        dt.strftime("%Y-%m-%d") if dt else "",
            "datetime":    r.get("Horário de publicação", ""),
            "caption":     (r.get("Descrição") or "").replace("\n", " ").strip()[:200],
            "permalink":   r.get("Link permanente", ""),
            "reach":       reach,
            "views":       views,
            "replies":     replies,
            "profile_visits": visits,
            "link_clicks": link_clicks,
            "navigation":  nav,
            "sticker_taps": stickers,
        })
    stories.sort(key=lambda s: s["date"], reverse=True)
    return stories


def build_stories_daily(stories):
    daily = defaultdict(lambda: {"reach": 0, "views": 0, "replies": 0, "link_clicks": 0, "profile_visits": 0, "count": 0})
    for s in stories:
        if not s["date"]:
            continue
        d = daily[s["date"]]
        d["date"]           = s["date"]
        d["reach"]          += s["reach"]
        d["views"]          += s["views"]
        d["replies"]        += s["replies"]
        d["link_clicks"]    += s["link_clicks"]
        d["profile_visits"] += s["profile_visits"]
        d["count"]          += 1
    return sorted(daily.values(), key=lambda d: d["date"])


def build_stories_summary(stories):
    total_reach    = sum(s["reach"] for s in stories)
    total_views    = sum(s["views"] for s in stories)
    total_replies  = sum(s["replies"] for s in stories)
    total_visits   = sum(s["profile_visits"] for s in stories)
    total_clicks   = sum(s["link_clicks"] for s in stories)
    n = max(len(stories), 1)
    return {
        "total_stories":    len(stories),
        "total_reach":      total_reach,
        "total_views":      total_views,
        "total_replies":    total_replies,
        "total_profile_visits": total_visits,
        "total_link_clicks": total_clicks,
        "avg_reach":        round(total_reach / n),
        "avg_views":        round(total_views / n),
    }


def build_stories_top(stories):
    def top5(key):
        return [
            {k: s.get(k) for k in ("id","date","caption","permalink","reach","views","replies","link_clicks","profile_visits")}
            for s in sorted(stories, key=lambda s: s[key], reverse=True)[:5]
        ]
    return {
        "by_reach":    top5("reach"),
        "by_views":    top5("views"),
        "by_replies":  top5("replies"),
        "by_clicks":   top5("link_clicks"),
    }


def process_account(all_rows, story_rows, username, config, period_start, period_end):
    rows = [r for r in all_rows if r["Nome de usuário da conta"] == username]
    rows = deduplicate(rows)
    posts = build_posts(rows)
    monthly = build_monthly(posts)
    summary = build_summary(posts, period_start, period_end)
    insights = generate_insights(posts, monthly)

    for p in posts:
        p["shortcode"] = shortcode_from_url(p.get("permalink", ""))

    daily          = build_daily(posts)
    top_posts      = build_top_posts(posts)
    daily_insights = generate_daily_insights(daily, posts)
    # stories
    stories         = build_stories(story_rows, username) if story_rows else []
    stories_daily   = build_stories_daily(stories)
    stories_summary = build_stories_summary(stories)
    stories_top     = build_stories_top(stories)

    # copywriting + posting time (shown together in the strategy analysis section)
    copy_insights = analyze_copywriting(posts) + analyze_posting_times(posts, stories)

    output = {
        "account": {
            "username":    username,
            "name":        config["name"],
            "followers":   config["followers"],
            "media_count": len(posts),
            "updated_at":  period_end,
        },
        "summary":          summary,
        "monthly":          monthly,
        "daily":            daily,
        "top_posts":        top_posts,
        "posts":            posts,
        "insights":         insights,
        "daily_insights":   daily_insights,
        "copy_insights":    copy_insights,
        "stories":          stories,
        "stories_daily":    stories_daily,
        "stories_summary":  stories_summary,
        "stories_top":      stories_top,
    }

    out_path = DATA_DIR / f"{username}.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"✓ {username}: {len(posts)} posts + {len(stories)} stories → {out_path.name}")
    print(f"  Posts — Alcance: {summary['total_reach']:,} | Engajamento: {summary['total_engagement']:,}")
    print(f"  Stories — Alcance: {stories_summary['total_reach']:,} | Views: {stories_summary['total_views']:,}")


def main():
    all_csvs = sorted(glob.glob(str(BASE_DIR / "*.csv")))
    if not all_csvs:
        print("❌ Nenhum CSV encontrado na pasta.")
        sys.exit(1)

    # Separate posts vs stories CSVs (a file may contain multiple accounts)
    posts_csvs   = []
    stories_csvs = []
    for path in all_csvs:
        with open(path, encoding="utf-8-sig") as f:
            sample = f.read(8000)
        if "Story do Instagram" in sample:
            stories_csvs.append(path)
        else:
            posts_csvs.append(path)

    if not posts_csvs:
        print("❌ Nenhum CSV de posts encontrado.")
        sys.exit(1)

    for p in posts_csvs:
        print(f"📂 Posts:   {Path(p).name}")
    for p in stories_csvs:
        print(f"📂 Stories: {Path(p).name}")
    print()

    # Merge all rows from all posts CSVs and all stories CSVs
    all_rows   = []
    for path in posts_csvs:
        all_rows.extend(load_csv(path))

    story_rows = []
    for path in stories_csvs:
        story_rows.extend(load_csv(path))

    all_dates = [parse_date(r.get("Horário de publicação", "")) for r in all_rows + story_rows]
    dates = [d for d in all_dates if d]
    period_start = min(dates).strftime("%d/%m/%Y") if dates else "—"
    period_end   = max(dates).strftime("%d/%m/%Y") if dates else "—"

    # Only process accounts that actually appear in the loaded data
    present = {r["Nome de usuário da conta"] for r in all_rows + story_rows}
    for username, config in ACCOUNTS_CONFIG.items():
        if username not in present:
            print(f"⚠️  {username} não encontrado nos CSVs — pulando.")
            continue
        process_account(all_rows, story_rows, username, config, period_start, period_end)

    print(f"\n✅ Dados processados! Abra index.html no browser.")


if __name__ == "__main__":
    main()
