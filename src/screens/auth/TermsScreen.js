import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  PanResponder, Alert, ActivityIndicator, Platform,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme';

const T_AND_C = [
  {
    heading: null,
    body: `These Terms of Service ("Terms") govern your access to and use of Urban PL, a pickup soccer league platform. By creating an account and using Urban PL you agree to be bound by these Terms. Please read them carefully before proceeding.`,
  },
  {
    heading: '1. YOUR ACCOUNT',
    body: `1.1. You must be 16 years of age or older to create an account and participate in Urban PL games. By registering, you confirm that you meet this requirement.

1.2. You are responsible for all activity that occurs under your account. Keep your login credentials private and notify us immediately at urbanpl.app@gmail.com if you suspect any unauthorized access.

1.3. You must provide accurate, complete, and up-to-date information including your real name and a genuine profile photo. Fake profiles or impersonation of another person will result in immediate account termination.

1.4. Urban PL reserves the right to suspend or terminate any account that violates these Terms, engages in unsportsmanlike conduct, or is found to be fraudulent — with or without prior notice.`,
  },
  {
    heading: '2. PAYMENTS & REFUNDS',
    body: `2.1. Entry fees for paid games are processed securely through Stripe. By submitting payment you authorize Urban PL to charge the stated amount to your selected payment method.

2.2. A temporary authorization hold is placed when you join a paid game. You are charged only when the game is confirmed. If the game does not reach minimum player requirements the hold is released, which may take a few hours depending on your bank.

2.3. Cancellation and refund policy:
  • More than 5 hours before kickoff: Full refund or game credit (your choice).
  • 3–5 hours before kickoff: Game credit only, subject to finding a replacement player.
  • Less than 3 hours before kickoff: No refund.

2.4. Urban PL is not liable for payment processing delays, bank fees, or declined card charges.`,
  },
  {
    heading: '3. GAME CONDUCT',
    body: `3.1. All participants must follow the Community Guidelines displayed on each game. These include but are not limited to: arriving on time, respecting the referee's decisions, and maintaining sportsmanlike behavior at all times.

3.2. Any form of fighting, verbal abuse, discrimination, or threatening behavior will result in an immediate and permanent ban from Urban PL with no refund.

3.3. Referee decisions are final during a game. Disputes may be reported post-game to urbanpl.app@gmail.com and will be reviewed at Urban PL's discretion.

3.4. Only registered and confirmed players are permitted to participate. Bringing unregistered guests onto the pitch is not permitted.`,
  },
  {
    heading: '4. LIABILITY',
    body: `4.1. Participation in Urban PL games involves physical activity and inherent risk of injury. By participating you acknowledge and accept these risks. Urban PL, its organizers, referees, and partners are not liable for any injury, loss, or damage sustained during participation.

4.2. Urban PL is not responsible for personal property lost, stolen, or damaged at any game venue.

4.3. Urban PL makes reasonable efforts to confirm games but cannot guarantee that any specific game will proceed. We are not liable for costs incurred (e.g. travel) if a game is cancelled.`,
  },
  {
    heading: '5. PRIVACY',
    body: `5.1. Urban PL collects personal information including your name, email address, phone number, and profile photo for the purpose of operating the platform, managing game registrations, and communicating with you about your account and upcoming games.

5.2. We do not sell or share your personal data with third parties except as required to deliver our services (e.g. Stripe for payment processing).

5.3. Full details are available in our Privacy Policy at theurbanpl.com/privacy-policy.html.`,
  },
  {
    heading: '6. CHANGES TO TERMS',
    body: `Urban PL reserves the right to update these Terms at any time. Continued use of the app after changes are posted constitutes your acceptance of the revised Terms. We will make reasonable efforts to notify you of material changes via email or in-app notification.`,
  },
];

export default function TermsScreen({ onAccepted }) {
  const { player } = useAuth();
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const paths = useRef([]);         // array of SVG path strings
  const currentPath = useRef(null); // current path being drawn
  const [svgPaths, setSvgPaths] = useState([]);
  const sigAreaLayout = useRef({ x: 0, y: 0 });

  // ── PanResponder for signature drawing ──────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
      },
      onPanResponderMove: (evt) => {
        if (!currentPath.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        setSvgPaths([...paths.current, currentPath.current]);
      },
      onPanResponderRelease: () => {
        if (currentPath.current) {
          paths.current = [...paths.current, currentPath.current];
          currentPath.current = null;
          if (!signed && paths.current.length > 0) setSigned(true);
        }
      },
    })
  ).current;

  function clearSignature() {
    paths.current = [];
    currentPath.current = null;
    setSvgPaths([]);
    setSigned(false);
  }

  async function handleContinue() {
    if (!signed) {
      Alert.alert('Signature Required', 'Please sign above before continuing.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('players')
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq('id', player.id);
    setSaving(false);
    if (error) {
      Alert.alert('Error', 'Could not save. Please try again.');
    } else {
      onAccepted?.();
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Terms and Conditions</Text>
      </View>

      {/* T&C Text */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          By signing below you confirm that you have read and agree to Urban PL's Terms and Conditions.
        </Text>

        {T_AND_C.map((section, i) => (
          <View key={i} style={styles.section}>
            {section.heading && <Text style={styles.sectionHeading}>{section.heading}</Text>}
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}

        {/* Signature area */}
        <View style={styles.sigWrap}>
          <Text style={styles.sigLabel}>Please, sign here</Text>
          <View
            style={styles.sigCanvas}
            {...panResponder.panHandlers}
            onLayout={(e) => {
              sigAreaLayout.current = {
                x: e.nativeEvent.layout.x,
                y: e.nativeEvent.layout.y,
              };
            }}
          >
            <Svg style={StyleSheet.absoluteFill}>
              {svgPaths.map((d, i) => (
                <Path
                  key={i}
                  d={d}
                  stroke={colors.dark}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ))}
            </Svg>
            {svgPaths.length === 0 && (
              <Text style={styles.sigPlaceholder}>✍️</Text>
            )}
          </View>
          <View style={styles.sigLine} />
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Bottom actions */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, (!signed || saving) && styles.continueBtnDisabled]}
          onPress={handleContinue}
          disabled={!signed || saving}
        >
          {saving
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.continueTxt}>Continue</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={clearSignature} style={styles.clearBtn}>
          <Text style={styles.clearTxt}>Clear signature</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 17, fontWeight: '700', color: '#111', textAlign: 'center',
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 20 },

  intro: {
    fontSize: 13, color: '#555', lineHeight: 20, marginBottom: 20,
    fontStyle: 'italic',
  },

  section: { marginBottom: 20 },
  sectionHeading: {
    fontSize: 14, fontWeight: '800', color: '#111',
    marginBottom: 8, letterSpacing: 0.3,
  },
  sectionBody: {
    fontSize: 13, color: '#444', lineHeight: 21,
  },

  // Signature
  sigWrap: { marginTop: 24 },
  sigLabel: {
    fontSize: 13, color: '#3a7bd5', fontWeight: '500', marginBottom: 10,
  },
  sigCanvas: {
    height: 110,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  sigPlaceholder: { fontSize: 32, opacity: 0.2 },
  sigLine: {
    height: 1.5, backgroundColor: '#ccc', marginTop: 8,
  },

  // Footer
  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#eee',
    paddingHorizontal: 20, paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  continueBtn: {
    backgroundColor: '#555',
    borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 10,
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  clearBtn: { alignItems: 'center', paddingVertical: 6 },
  clearTxt: { color: '#555', fontSize: 14 },
});
