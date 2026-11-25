import { searchAll } from "../googlenews";
import type { Scraper } from "./scraper";

type SearchAll = typeof searchAll;

const isYouTubeOrigin = (url: string) => /(^|\.)(youtube\.com|youtu\.be)$/i.test(URL.canParse(url) ? new URL(url).hostname : "");

export function createRssScraper({ searchAll: search = searchAll, now = () => new Date() }: { searchAll?: SearchAll; now?: () => Date } = {}): Scraper {
  return {
    async scrape() {
      const end = now();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const date = end.toISOString().slice(0, 10);
      const previous = start.toISOString().slice(0, 10);
      const { articles } = await search(previous, date);
      // Video YouTube ikut muncul di hasil Google News; YouTube tidak dipakai lagi (keputusan pemakai 18 Nov 2026).
      return articles.filter((article) => !isYouTubeOrigin(article.sourceUrl)).map((article) => ({
        title: article.title,
        canonicalUrl: article.link,
        ...(article.pubDate ? { publishedAt: new Date(`${article.pubDate}T00:00:00.000Z`) } : {}),
        ...(article.desc ? { description: article.desc } : {}),
        ...(article.sourceUrl ? { publisherUrl: article.sourceUrl } : {}),
      }));
    },
  };
}
