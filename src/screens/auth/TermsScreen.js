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
    body: `To all participants — these Terms of Service (the "Terms") set out the terms and conditions by which Urban PL offers you access to use and enjoy all our services. Urban PL is a pickup soccer league app that connects players, referees, and organizers across cities.\n\nPlease read these Terms carefully and make sure you understand them before using the app. By creating an account you agree to follow our rules. You are responsible for all content and activity on your account. Urban PL has no liability for content loss or problems with transmission of content.\n\nAttention: if you are under 18, please ensure a parent or guardian is aware you are using this app.`,
  },
  {
    heading: '1. YOUR ACCOUNT',
    body: `1.1. You must be 16 years of age or older to create an account and participate in Urban PL games. By registering, you confirm that you meet this age requirement.

1.2. To create an account you must: (i) be at least 16 years old; or (ii) have valid parent or legal guardian consent. If you are unsure about this section, please speak to a parent or guardian before proceeding.

1.3. You must always supply us with accurate and complete information, including your real name and a genuine profile photo. This lets your teammates and referees know who's showing up. False information or impersonation of any other person will result in immediate account removal.

1.4. What email do I use? We send account, legal, and game-related notifications to the email address registered to your account. These may include game confirmations, team assignments, lineup notifications, and match reminders — so keep your email current.

1.5. Account security: You must keep your login credentials private. Notify us immediately at urbanpl.app@gmail.com if you become aware of any breach, unauthorized access, or loss of your login details. You are responsible for all activity on your account.`,
  },
  {
    heading: '2. ACCOUNT TERMINATION',
    body: `2.1. Can my account be suspended or terminated?

2.1.1. You. You may close your account at any time by contacting us at urbanpl.app@gmail.com.

2.1.2. Us. We may suspend or terminate your account without notice if we reasonably determine that: you have breached any part of these Terms; you have made unauthorized use of another person's account; you are posting unacceptable content; or your conduct on or off the pitch is deemed harmful to other players, referees, or the Urban PL community. If you believe a mistake has been made, contact us and we will review — though we may keep the account suspended during that review.

2.2. Inactive accounts. If you abandon your account for a prolonged period without use, Urban PL reserves the right to deactivate or remove it.`,
  },
  {
    heading: '3. PAYMENTS & REFUNDS',
    body: `3.1. Entry fees for paid games are processed securely through Stripe. By submitting payment you authorize Urban PL to charge the stated amount to your selected payment method.

3.2. We place a temporary authorization hold when you join a paid game. You are charged only once the game is confirmed. If the game does not reach the minimum number of players, the hold is released — this may take a few hours depending on your bank.

3.3. Cancellation policy:
  • More than 5 hours before kickoff — Full refund or game credit (your choice).
  • 3–5 hours before kickoff — Game credit only, subject to finding a replacement.
  • Less than 3 hours before kickoff — No refund.

3.4. A $0.50 fee applies for declined cards. Urban PL is not liable for payment processing delays or bank-imposed fees.`,
  },
  {
    heading: '4. GAME CONDUCT',
    body: `4.1. All participants must follow the Community Guidelines shown on each game. This includes arriving on time, respecting the referee, and maintaining sportsmanlike behavior.

4.2. Fighting, verbal abuse, threats, or any form of discrimination will result in an immediate permanent ban with no refund issued.

4.3. Referee decisions are final during a game. Post-game disputes can be reported to urbanpl.app@gmail.com and will be reviewed at Urban PL's discretion.

4.4. Only registered and confirmed players may take the pitch. Unregistered guests are not permitted.`,
  },
  {
    heading: '5. LIABILITY & SAFETY',
    body: `5.1. Participation in Urban PL games involves physical activity and carries an inherent risk of injury. By participating you acknowledge and accept these risks. Urban PL, its organizers, referees, and partners are not liable for any injury, loss, or damage sustained during or in connection with participation.

5.2. Urban PL is not responsible for personal property that is lost, stolen, or damaged at any game venue.

5.3. While we make every effort to confirm games, we cannot guarantee any specific game will proceed. We are not liable for costs you incur (e.g. travel) if a game is cancelled.`,
  },
  {
    heading: '6. PRIVACY',
    body: `6.1. Urban PL collects your name, email, phone number, and profile photo to operate the platform, manage game registrations, and keep you informed about your account and upcoming games.

6.2. We do not sell your personal data. We share it only as necessary to deliver our services (e.g. Stripe for payment processing, Supabase for data storage).

6.3. Full details are in our Privacy Policy at theurbanpl.com/privacy-policy.html.`,
  },
  {
    heading: '7. CHANGES TO THESE TERMS',
    body: `Urban PL may update these Terms at any time. Continued use of the app after changes are posted means you accept the updated Terms. We will notify you of material changes via email or in-app notice.

For questions about these Terms, contact us at urbanpl.app@gmail.com.`,
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
