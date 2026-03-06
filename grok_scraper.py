#!/usr/bin/env python3
"""
Grok Scraper - 使用 xAI Grok API 進行資料查詢與爬取
"""

import os
import json
import time
import argparse
from typing import Optional
import requests


GROK_API_BASE = "https://api.x.ai/v1"


class GrokScraper:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("XAI_API_KEY", "")
        if not self.api_key:
            raise ValueError("請設定 XAI_API_KEY 環境變數或傳入 api_key 參數")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        })

    def chat(self, prompt: str, model: str = "grok-2-latest", stream: bool = False) -> dict:
        """發送訊息給 Grok 並取得回應"""
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": stream,
        }
        resp = self.session.post(f"{GROK_API_BASE}/chat/completions", json=payload, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def scrape_topic(self, topic: str, questions: list[str]) -> list[dict]:
        """針對某個主題，批次查詢多個問題並收集回答"""
        results = []
        for q in questions:
            print(f"[查詢] {q}")
            try:
                data = self.chat(f"關於「{topic}」：{q}")
                answer = data["choices"][0]["message"]["content"]
                results.append({"question": q, "answer": answer})
                print(f"[完成] 已取得回答（{len(answer)} 字）")
            except requests.HTTPError as e:
                print(f"[錯誤] HTTP {e.response.status_code}: {e.response.text}")
                results.append({"question": q, "error": str(e)})
            except Exception as e:
                print(f"[錯誤] {e}")
                results.append({"question": q, "error": str(e)})
            time.sleep(1)  # 避免速率限制
        return results

    def list_models(self) -> list[dict]:
        """列出可用的 Grok 模型"""
        resp = self.session.get(f"{GROK_API_BASE}/models", timeout=30)
        resp.raise_for_status()
        return resp.json().get("data", [])

    def save_results(self, results: list[dict], output_file: str = "grok_results.json"):
        """將結果儲存為 JSON 檔案"""
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"[儲存] 結果已寫入 {output_file}")


def main():
    parser = argparse.ArgumentParser(description="Grok 爬蟲工具")
    parser.add_argument("--api-key", help="xAI API 金鑰（或設定 XAI_API_KEY 環境變數）")
    parser.add_argument("--topic", default="人工智慧", help="查詢主題（預設：人工智慧）")
    parser.add_argument("--output", default="grok_results.json", help="輸出 JSON 檔案名稱")
    parser.add_argument("--list-models", action="store_true", help="列出可用模型")
    parser.add_argument("--prompt", help="單一查詢提示詞")
    args = parser.parse_args()

    scraper = GrokScraper(api_key=args.api_key)

    if args.list_models:
        models = scraper.list_models()
        print("可用模型：")
        for m in models:
            print(f"  - {m.get('id', m)}")
        return

    if args.prompt:
        data = scraper.chat(args.prompt)
        answer = data["choices"][0]["message"]["content"]
        print(f"\n[Grok 回應]\n{answer}")
        return

    # 預設：針對主題批次查詢
    questions = [
        f"請簡介{args.topic}的最新發展趨勢",
        f"{args.topic}目前最重要的應用場景有哪些？",
        f"{args.topic}面臨的主要挑戰是什麼？",
    ]
    results = scraper.scrape_topic(args.topic, questions)
    scraper.save_results(results, args.output)
    print(f"\n共完成 {len(results)} 筆查詢")


if __name__ == "__main__":
    main()
