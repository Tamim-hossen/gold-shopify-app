import { NextResponse } from 'next/server';
import { getSettings, addLog } from '@/lib/db';
import { fetchLiveGoldRates } from '@/lib/goldapi';
import {
  fetchShopifyProducts,
  updateShopifyVariantPrice,
  updateShopifyProductMetafields,
} from '@/lib/shopify';

// Helper to calculate pricing based on weight, karat, diamond price, rates, and settings
function calculateVariantPrice(weight, karatStr, diamondPrice, rates, settings, variantTitle) {
  let karat = karatStr;
  
  // Fallback: Parse karat from variant title (e.g. "18K", "14 K", "22k")
  if (!karat && variantTitle) {
    const match = variantTitle.match(/(\d+)\s*k/i);
    if (match) {
      karat = match[0].toUpperCase().replace(/\s+/, '');
    }
  }

  if (!karat) {
    karat = settings.defaultKarat;
  }

  const karatNum = parseInt(karat.replace(/[^0-9]/g, '')) || 18;
  const karatKey = `price_gram_${karatNum}k`;
  
  let goldPricePerGram = rates[karatKey];
  if (!goldPricePerGram) {
    const priceGram24k = rates.price_gram_24k || (rates.price / 31.1035);
    goldPricePerGram = priceGram24k * (karatNum / 24);
  }

  const baseGoldCost = weight * goldPricePerGram;
  
  // Making charges: (weight * perGram) + fixed
  const makingCharges = (weight * settings.makingChargePerGram) + settings.makingChargeFixed;
  
  // Subtotal (including diamond price)
  const parsedDiamondPrice = parseFloat(diamondPrice) || 0;
  const subtotal = baseGoldCost + parsedDiamondPrice + makingCharges;
  
  // Markup multiplier
  const markupMultiplier = 1 + (settings.markupPercentage / 100);
  
  // Price before Tax: subtotal * multiplier + fixedMarkup
  const priceBeforeTax = (subtotal * markupMultiplier) + settings.fixedMarkup;

  // GST calculation
  const gstAmount = priceBeforeTax * (settings.gstPercentage / 100);

  // Final Price
  const finalPrice = priceBeforeTax + gstAmount;
  
  return {
    finalPrice: Number(finalPrice.toFixed(2)),
    breakdown: {
      goldPricePerGram: Number(goldPricePerGram.toFixed(4)),
      baseGoldCost: Number(baseGoldCost.toFixed(2)),
      diamondPrice: parsedDiamondPrice,
      makingCharges: Number(makingCharges.toFixed(2)),
      markupAmount: Number((subtotal * (markupMultiplier - 1)).toFixed(2)),
      fixedMarkup: settings.fixedMarkup,
      priceBeforeTax: Number(priceBeforeTax.toFixed(2)),
      gstAmount: Number(gstAmount.toFixed(2)),
      karatUsed: `${karatNum}K`,
    }
  };
}

export async function GET() {
  try {
    const settings = await getSettings();
    
    if (!settings.shopifyShop || !settings.shopifyAccessToken) {
      return NextResponse.json({
        products: [],
        warning: 'Shopify is not configured. Please visit the Settings page.',
      });
    }

    let rates;
    try {
      rates = await fetchLiveGoldRates();
    } catch (e) {
      return NextResponse.json(
        { error: `GoldAPI Error: ${e.message}. Please verify your API Key in Settings.` },
        { status: 500 }
      );
    }

    const products = await fetchShopifyProducts();
    
    // Enrich variants of each product using product-level weight/diamond fields
    const enrichedProducts = products.map((product) => {
      const isGold = product.weightValue !== null && product.weightValue > 0;
      let productOutOfSync = false;

      const enrichedVariants = product.variants.map((variant) => {
        if (!isGold) {
          return {
            ...variant,
            isGoldVariant: false,
            calculatedPrice: null,
            outOfSync: false,
          };
        }

        // Run calculation: weight and diamondPrice come from product level, karat is variant-dependent
        const { finalPrice, breakdown } = calculateVariantPrice(
          product.weightValue,
          product.karatValue, // product-level karat fallback
          product.diamondPrice, // product-level diamond price
          rates,
          settings,
          variant.title // variant-level title (for karat parsing)
        );

        const diff = Math.abs(parseFloat(variant.price) - finalPrice);
        const outOfSync = diff > 0.05;

        if (outOfSync) {
          productOutOfSync = true;
        }

        return {
          ...variant,
          isGoldVariant: true,
          calculatedPrice: finalPrice,
          priceBreakdown: breakdown,
          outOfSync,
        };
      });

      return {
        ...product,
        variants: enrichedVariants,
        isGoldProduct: isGold,
        outOfSync: productOutOfSync,
      };
    });

    return NextResponse.json({
      products: enrichedProducts,
      goldRates: rates,
    });
  } catch (error) {
    console.error('Products fetch/enrichment error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch and enrich products' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { action, ...payload } = await request.json();
    
    if (action === 'update_metafields') {
      const { productId, weight, karat, diamondPrice } = payload;
      
      if (!productId) {
        return NextResponse.json({ error: 'productId is required' }, { status: 400 });
      }

      const parsedWeight = weight !== undefined && weight !== '' ? parseFloat(weight) : null;
      const parsedKarat = karat !== undefined && karat !== '' ? karat : null;
      const parsedDiamondPrice = diamondPrice !== undefined && diamondPrice !== '' ? parseFloat(diamondPrice) : null;

      await updateShopifyProductMetafields(productId, parsedWeight, parsedKarat, parsedDiamondPrice);
      
      return NextResponse.json({ success: true, message: 'Product metafields updated successfully' });
    }
    
    if (action === 'sync_variant') {
      const { productId, productTitle, variantId, variantTitle, newPrice, oldPrice } = payload;
      
      if (!productId || !variantId || !newPrice) {
        return NextResponse.json({ error: 'productId, variantId and newPrice are required' }, { status: 400 });
      }

      await updateShopifyVariantPrice(productId, variantId, newPrice.toString());
      
      await addLog({
        status: 'success',
        type: 'single',
        details: `Updated '${productTitle}' (${variantTitle || 'Default'}) price from $${oldPrice} to $${newPrice}`,
        productsUpdated: 1,
      });

      return NextResponse.json({ success: true, message: 'Variant price synced successfully' });
    }

    if (action === 'sync_bulk') {
      const { items } = payload;
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'items array is required' }, { status: 400 });
      }

      let successCount = 0;
      let failCount = 0;
      const errors = [];

      for (const item of items) {
        try {
          await updateShopifyVariantPrice(item.productId, item.variantId, item.newPrice.toString());
          successCount++;
        } catch (error) {
          failCount++;
          errors.push(`${item.productTitle} (${item.variantTitle}): ${error.message}`);
        }
      }

      if (successCount > 0) {
        await addLog({
          status: failCount > 0 ? 'failed' : 'success',
          type: 'bulk',
          details: `Bulk sync: successfully updated ${successCount} variant prices.${
            failCount > 0 ? ` Failed ${failCount} variants.` : ''
          }`,
          productsUpdated: successCount,
        });
      }

      return NextResponse.json({
        success: failCount === 0,
        successCount,
        failCount,
        errors,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('API products action error:', error);
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 500 }
    );
  }
}
