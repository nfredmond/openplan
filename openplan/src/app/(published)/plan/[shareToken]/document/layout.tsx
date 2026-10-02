/**
 * The plan document page renders an `<article>` and no `<main>`. Its sibling
 * pages in this route group each render their own `<main>`, and the group
 * layout adds none, so this segment supplies the one this page needs.
 */
export default function PublicPlanDocumentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main>{children}</main>;
}
