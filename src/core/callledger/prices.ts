// Deliberately empty: dated prices and exact model IDs must be verified at activation.
export interface Price { model: string; verifiedAt: string; inputUsdPerMillion: number; outputUsdPerMillion: number;
  /** Only a documented service-enforced bound may enable paid choice evaluation. */
  choiceOutputBound?: { tokensPerRequest: number; verifiedAt: string; sourceUrl: string } }
export const PRICES: readonly Price[] = [];
export function priceFor(model: string, prices: readonly Price[] = PRICES): Price | null {
  const price = prices.find((entry) => entry.model === model);
  if (!price || !/^\d{4}-\d{2}-\d{2}$/.test(price.verifiedAt) || !Number.isFinite(Date.parse(price.verifiedAt)) ||
    !Number.isFinite(price.inputUsdPerMillion) || price.inputUsdPerMillion < 0 || !Number.isFinite(price.outputUsdPerMillion) || price.outputUsdPerMillion < 0) return null;
  return price;
}
export function pricesReady(models: readonly string[], prices: readonly Price[] = PRICES): boolean { return models.length > 0 && models.every((model) => priceFor(model, prices) !== null); }
export function choiceOutputBound(price: Price): number | null {
  const bound = price.choiceOutputBound;
  return bound && Number.isSafeInteger(bound.tokensPerRequest) && bound.tokensPerRequest > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(bound.verifiedAt) && Number.isFinite(Date.parse(bound.verifiedAt)) && /^https:\/\/docs\.typesafe\.ai\//.test(bound.sourceUrl) ? bound.tokensPerRequest : null;
}
