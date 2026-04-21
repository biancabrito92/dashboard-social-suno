"""
fetch_instagram.py — Busca dados das contas do Instagram via Meta Graph API
e salva em data/<username>.json para o dashboard consumir.

Configuração:
  1. Crie um App no Meta for Developers (developers.facebook.com)
  2. Adicione o produto "Instagram Graph API"
  3. Gere um Page Access Token com as permissões:
       instagram_manage_insights, instagram_basic, pages_read_engagement
  4. Copie o token e o Instagram Business Account ID para o .env
"""

import os
import json
import datetime
import requests
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

GRAPH_URL = "https://graph.facebook.com/v19.0"

ACCOUNTS = {
    "suno": {
        "ig_user_id":    os.getenv("SUNO_IG_USER_ID", ""),
        "access_token":  os.getenv("SUNO_ACCESS_TOKEN", ""),
        "display_name":  "Suno Investimentos",
    },
    "tiagogreis": {
        "ig_user_id":    os.getenv("TIAGO_IG_USER_ID", ""),
        "access_token":  os.getenv("TIAGO_ACCESS_TOKEN", ""),
        "display_name":  "Tiago Reis | Investimentos",
    },
}

SINCE = "2026-01-01"
UNTIL = datetime.date.today().isoformat()


def get(endpoint, params):
    resp = requests.get(f"{GRAPH_URL}/{endpoint}", params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_account_info(ig_user_id, token):
    fields = "username,name,followers_count,follows_count,media_count,profile_picture_url"
    return get(ig_user_id, {"fields": fields, "access_token": token})


def fetch_account_insights(ig_user_id, token):
    """Alcance e impressões a nível de conta (últimos 30 dias via período)."""
    metrics = "reach,impressions,follower_count"
    params = {
        "metric": metrics,
        "period": "month",
        "access_token": token,
    }
    data = get(f"{ig_user_id}/insights", params)
    result = {}
    for item in data.get("data", []):
        result[item["name"]] = item["values"]
    return result


def fetch_media(ig_user_id, token, limit=100):
    """Busca posts de 2026 com métricas detalhadas."""
    fields = (
        "id,timestamp,media_type,caption,thumbnail_url,media_url,"
        "like_count,comments_count"
    )
    params = {
        "fields": fields,
        "limit": limit,
        "since": SINCE,
        "until": UNTIL,
        "access_token": token,
    }
    data = get(f"{ig_user_id}/media", params)
    media_items = data.get("data", [])

    # Busca insights individuais de cada post
    posts = []
    for item in media_items:
        try:
            insights = fetch_post_insights(item["id"], item["media_type"], token)
            posts.append({**item, **insights})
        except Exception as e:
            print(f"  ⚠ Erro no post {item['id']}: {e}")
            posts.append(item)

    return posts


def fetch_post_insights(media_id, media_type, token):
    """Retorna reach, impressions, saved, shares para um post."""
    if media_type in ("VIDEO", "REELS"):
        metrics = "reach,impressions,saved,shares,plays"
    else:
        metrics = "reach,impressions,saved,shares"

    params = {"metric": metrics, "access_token": token}
    data = get(f"{media_id}/insights", params)

    result = {}
    for item in data.get("data", []):
        result[item["name"]] = item["values"][0]["value"] if item.get("values") else 0
    return result


def compute_summary(posts, account_info):
    total_reach      = sum(p.get("reach", 0) for p in posts)
    total_impressions = sum(p.get("impressions", 0) for p in posts)
    total_likes      = sum(p.get("like_count", 0) for p in posts)
    total_comments   = sum(p.get("comments_count", 0) for p in posts)
    total_shares     = sum(p.get("shares", 0) for p in posts)
    total_saves      = sum(p.get("saved", 0) for p in posts)
    total_engagement = total_likes + total_comments + total_shares + total_saves
    followers        = account_info.get("followers_count", 1)
    avg_eng_rate     = round((total_engagement / max(len(posts), 1)) / followers * 100, 2)

    return {
        "period": f"{SINCE} a {UNTIL}",
        "total_reach": total_reach,
        "total_impressions": total_impressions,
        "total_engagement": total_engagement,
        "avg_engagement_rate": avg_eng_rate,
        "total_posts": len(posts),
        "follower_growth": 0,
        "follower_growth_pct": 0.0,
    }


def build_monthly(posts):
    monthly = {}
    for p in posts:
        ts = p.get("timestamp", "")
        if not ts:
            continue
        dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        key = dt.strftime("%b/%y").capitalize()
        if key not in monthly:
            monthly[key] = {"month": key, "reach": 0, "impressions": 0, "engagement": 0, "posts": 0, "new_followers": 0}
        monthly[key]["reach"]       += p.get("reach", 0)
        monthly[key]["impressions"] += p.get("impressions", 0)
        eng = (p.get("like_count", 0) + p.get("comments_count", 0)
               + p.get("shares", 0) + p.get("saved", 0))
        monthly[key]["engagement"]  += eng
        monthly[key]["posts"]       += 1
    return list(monthly.values())


def normalize_post(p, followers):
    likes    = p.get("like_count", 0)
    comments = p.get("comments_count", 0)
    shares   = p.get("shares", 0)
    saves    = p.get("saved", 0)
    engagement = likes + comments + shares + saves
    reach    = p.get("reach", 1)
    return {
        "id":              p["id"],
        "date":            p.get("timestamp", "")[:10],
        "type":            p.get("media_type", "IMAGE"),
        "caption":         (p.get("caption") or "")[:120],
        "thumbnail":       p.get("thumbnail_url") or p.get("media_url") or "",
        "reach":           p.get("reach", 0),
        "impressions":     p.get("impressions", 0),
        "likes":           likes,
        "comments":        comments,
        "shares":          shares,
        "saves":           saves,
        "engagement":      engagement,
        "engagement_rate": round(engagement / max(reach, 1) * 100, 2),
    }


def generate_insights(posts, account_name):
    if not posts:
        return []

    by_type = {"CAROUSEL_ALBUM": [], "VIDEO": [], "IMAGE": []}
    for p in posts:
        t = p.get("type", "IMAGE")
        if t in by_type:
            by_type[t].append(p.get("reach", 0))

    avg = {t: (sum(v) / len(v)) if v else 0 for t, v in by_type.items()}
    best_format = max(avg, key=lambda k: avg[k])
    format_names = {"CAROUSEL_ALBUM": "Carrossel", "VIDEO": "Vídeo", "IMAGE": "Imagem"}

    top_posts = sorted(posts, key=lambda p: p.get("engagement_rate", 0), reverse=True)[:3]
    top_captions = "; ".join(f'"{p["caption"][:40]}…"' for p in top_posts if p.get("caption"))

    return [
        {
            "type": "top",
            "icon": "🏆",
            "title": f"{format_names[best_format]} lidera o alcance",
            "body":  f"Posts em {format_names[best_format].lower()} têm o maior alcance médio: {avg[best_format]:,.0f} contas alcançadas.",
        },
        {
            "type": "action",
            "icon": "💡",
            "title": "Top posts do período",
            "body":  f"Maiores taxas de engajamento: {top_captions}",
        },
        {
            "type": "action",
            "icon": "🎯",
            "title": "Saves = conteúdo evergreen",
            "body":  "Posts com alta taxa de salvamento indicam conteúdo de referência. Produza mais conteúdo desse tipo.",
        },
    ]


def fetch_and_save(slug, config):
    print(f"\n📥 Buscando dados de @{slug}...")

    if not config["ig_user_id"] or not config["access_token"]:
        print(f"  ⚠ Credenciais não configuradas para @{slug}. Configure o .env.")
        return

    try:
        account_info = fetch_account_info(config["ig_user_id"], config["access_token"])
        raw_posts    = fetch_media(config["ig_user_id"], config["access_token"])
    except requests.HTTPError as e:
        print(f"  ✗ Erro na API: {e.response.status_code} — {e.response.text}")
        return

    followers = account_info.get("followers_count", 1)
    posts     = [normalize_post(p, followers) for p in raw_posts]
    posts.sort(key=lambda p: p["date"], reverse=True)

    output = {
        "account": {
            "username":        account_info.get("username", slug),
            "name":            config["display_name"],
            "followers":       followers,
            "following":       account_info.get("follows_count", 0),
            "media_count":     account_info.get("media_count", 0),
            "profile_picture": account_info.get("profile_picture_url", ""),
            "updated_at":      UNTIL,
        },
        "summary":  compute_summary(posts, account_info),
        "monthly":  build_monthly(raw_posts),
        "posts":    posts[:50],
        "insights": generate_insights(posts, config["display_name"]),
    }

    out_path = DATA_DIR / f"{slug}.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"  ✓ Salvo em {out_path} ({len(posts)} posts)")


def main():
    print(f"🚀 Iniciando fetch — {UNTIL}")
    for slug, config in ACCOUNTS.items():
        fetch_and_save(slug, config)
    print("\n✅ Concluído!")


if __name__ == "__main__":
    main()
