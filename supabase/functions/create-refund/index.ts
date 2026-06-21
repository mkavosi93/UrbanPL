import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { playerId, gameId, tournamentId } = await req.json();

    if (!playerId) {
      return new Response(
        JSON.stringify({ error: 'playerId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role key to bypass RLS and find the payment
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Look up the original payment record
    let query = supabase
      .from('payments')
      .select('id, stripe_payment_intent_id, amount, status')
      .eq('player_id', playerId)
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(1);

    if (gameId) {
      query = query.eq('game_id', gameId);
    } else if (tournamentId) {
      query = query.eq('tournament_id', tournamentId);
    }

    const { data: payments, error: paymentError } = await query;

    if (paymentError || !payments || payments.length === 0) {
      // No payment found — nothing to refund (free entry)
      return new Response(
        JSON.stringify({ refunded: false, reason: 'no_payment_found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payment = payments[0];

    // Issue the Stripe refund
    let refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        reason: 'requested_by_customer',
      });
    } catch (stripeErr: any) {
      // Already refunded in Stripe — mark DB as refunded and return success
      if (stripeErr?.code === 'charge_already_refunded') {
        await supabase
          .from('payments')
          .update({ status: 'refunded' })
          .eq('id', payment.id);
        return new Response(
          JSON.stringify({ refunded: true, amount: payment.amount, status: 'already_refunded' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw stripeErr;
    }

    // Mark the payment as refunded in the DB
    await supabase
      .from('payments')
      .update({ status: 'refunded' })
      .eq('id', payment.id);

    return new Response(
      JSON.stringify({
        refunded: true,
        refundId: refund.id,
        amount: payment.amount,
        status: refund.status,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Refund error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
