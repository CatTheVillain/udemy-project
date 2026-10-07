export interface CartPresentation {
  readonly badge: string | null;
}

export function presentCart(itemCount: number | undefined): CartPresentation {
  if (itemCount === undefined) return { badge: null };
  const badge = itemCount >= 100 ? '99+' : String(itemCount);
  return { badge };
}
