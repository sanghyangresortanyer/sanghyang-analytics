import type { Source } from "../db-types";

export type ScrapeContext = { source: Source; runId: string };

export type ScrapedArticle = {
  title: string;
  canonicalUrl: string;
  publishedAt?: Date;
  description?: string;
  content?: string;
  imageUrl?: string;
  /** Origin situs penerbit (RSS Google News: atribut url pada <source>). */
  publisherUrl?: string;
};

export type ScrapeFailure = {
  stage: "extract";
  url: string;
  message: string;
};

export interface Scraper {
  scrape(context: ScrapeContext): Promise<ScrapedArticle[]>;
}
