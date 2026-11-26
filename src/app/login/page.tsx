import type { Metadata } from "next";
import type { StaticImageData } from "next/image";
import { connection } from "next/server";
import { getLoginUsernames } from "@/lib/auth/login-users";
import aerial1280Avif from "./assets/resort-aerial-canopy-01-1280.avif";
import aerial1280Webp from "./assets/resort-aerial-canopy-01-1280.webp";
import aerial1920Avif from "./assets/resort-aerial-canopy-01-1920.avif";
import aerial1920Webp from "./assets/resort-aerial-canopy-01-1920.webp";
import logoWhite522 from "./assets/sanghyang-logo-white-522.webp";
import logoWhite1044 from "./assets/sanghyang-logo-white-1044.webp";
import { loginFontVariables } from "./fonts";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

const TAGLINE = "A comprehensive analytics workspace for resort operations, marketing and market intelligence.";

export const metadata: Metadata = {
  title: "Sanghyang Analytics",
  description: TAGLINE,
};

/** Never let a slow or unreachable Supabase block the login screen: fall back to typing. */
const FALLBACK_AFTER_MS = 3000;

const srcSet = (...images: StaticImageData[]) => images.map((image) => `${image.src} ${image.width}w`).join(", ");

// The official AVIF and WebP derivatives of sanghyang.com are served as they are (static imports land in
// /_next/static, outside the proxy), so the login photo costs no image-optimisation quota. On desktop the photo
// column is taller than it is wide, so "cover" makes the image as wide as its height times its aspect ratio.
const PHOTO_SIZES = `(min-width: 64rem) ${Math.ceil((aerial1920Webp.width / aerial1920Webp.height) * 100)}vh, 100vw`;
const LOGO_SIZES = "(min-width: 64rem) 12.5rem, (min-width: 40rem) 10rem, 8rem";

export default async function LoginPage() {
  await connection(); // render per request so the user list is never baked in at build time
  const fetchedUsernames = await Promise.race([
    getLoginUsernames().catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : "unknown";
      console.warn(`[auth] gagal memuat daftar user login: ${detail}`);
      return [] as string[];
    }),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), FALLBACK_AFTER_MS)),
  ]);

  const devUser =
    process.env.NODE_ENV === "development" && process.env.LOCAL_DEV_AUTH_USER
      ? process.env.LOCAL_DEV_AUTH_USER.trim()
      : undefined;

  const usernames =
    devUser && !fetchedUsernames.includes(devUser)
      ? [devUser, ...fetchedUsernames]
      : fetchedUsernames;

  // One DOM order for both layouts: on phones the photo is a short strip above the intro and the form; on desktop
  // the intro moves onto the bottom of the photo column.
  return (
    <main
      className={`${loginFontVariables} ${styles.root} grid min-h-dvh w-full flex-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:grid-rows-[minmax(0,1fr)_auto]`}
    >
      <div
        className={`${styles.photo} relative h-[clamp(9rem,6rem_+_12vw,12rem)] overflow-hidden p-5 sm:p-6 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-auto lg:p-10 xl:p-14`}
      >
        <picture className="absolute inset-0">
          <source type="image/avif" srcSet={srcSet(aerial1280Avif, aerial1920Avif)} sizes={PHOTO_SIZES} />
          <source type="image/webp" srcSet={srcSet(aerial1280Webp, aerial1920Webp)} sizes={PHOTO_SIZES} />
          <img
            src={aerial1920Webp.src}
            width={aerial1920Webp.width}
            height={aerial1920Webp.height}
            alt=""
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className={`${styles.photoImage} h-full w-full object-cover`}
          />
        </picture>
        <div aria-hidden className={`${styles.scrim} absolute inset-0`} />
        <picture className="relative block w-32 sm:w-40 lg:w-50">
          <source type="image/webp" srcSet={srcSet(logoWhite522, logoWhite1044)} sizes={LOGO_SIZES} />
          <img
            src={logoWhite522.src}
            width={logoWhite522.width}
            height={logoWhite522.height}
            alt="Sanghyang Indah Spa Resort"
            loading="eager"
            decoding="async"
            className="block h-auto w-full"
          />
        </picture>
      </div>

      <header
        className={`${styles.intro} relative px-5 pt-8 sm:px-8 lg:col-start-1 lg:row-start-2 lg:px-10 lg:pb-10 lg:pt-0 xl:px-14 xl:pb-14`}
      >
        <h1 className={styles.title}>
          <span className={styles.titleLine}>Sanghyang</span> <span className={styles.titleLine}>Analytics</span>
        </h1>
        <p className={styles.tagline}>{TAGLINE}</p>
      </header>

      <div className="flex justify-center px-5 pb-12 pt-10 sm:px-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:items-center lg:px-12 lg:py-16">
        <LoginForm usernames={usernames} />
      </div>
    </main>
  );
}
