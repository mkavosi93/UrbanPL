import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme';

const T_AND_C = [
  {
    heading: null,
    body: `To all participants — these Terms of Service (the "Terms") set out the terms and conditions by which Urban PL offers you access to use and enjoy all our services. Urban PL is a pickup soccer league app that connects players, referees, and organizers across cities.\n\nPlease read these Terms carefully and make sure you understand them before using the app. By creating an account you agree to follow our rules. You are responsible for all content and activity on your account. Urban PL has no liability for content loss or problems with transmission of content.`,
  },
  {
    heading: '1. YOUR ACCOUNT',
    body: `1.1. Age requirement. The minimum age to create an account and participate in Urban PL is 18 years old. This is a hard minimum — no exceptions. By registering, you confirm that you are 18 years of age or older.

1.2. You must always supply us with accurate and complete information, including your real name and a genuine profile photo. This lets your teammates and referees know who's showing up. False information or impersonation of any other person will result in immediate account removal.

1.3. Notifications. We send account, legal, and game-related notifications to the email address registered to your account. These include game confirmations, team assignments, lineup notifications, and match reminders — keep your email current.

1.4. Account security. You must keep your login credentials private. Notify us immediately at urbanpl.app@gmail.com if you become aware of any breach, unauthorized access, or loss of your login details. You are responsible for all activity that occurs under your account.`,
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
    heading: '5. ASSUMPTION OF RISK & WAIVER OF LIABILITY',
    body: `5.1. Acknowledgment of risk. I acknowledge and understand that participation in Urban PL soccer activities involves risks and dangers of serious bodily injury, including permanent disability, paralysis, and death ("Risks"). These risks may be caused by my own actions or inactions, the actions or inactions of other participants, the condition of the venue, or the acts or negligence of Urban PL, its organizers, referees, employees, volunteers, and agents (collectively the "Releasees"). I freely and voluntarily accept and assume all such risks and responsibility for any losses, costs, and damages I may incur as a result of my participation.

5.2. Physical fitness. I represent that I am in good health and in proper physical condition to participate in Urban PL activities. If at any time I believe conditions or my health make participation unsafe, I will immediately stop participating.

5.3. Release of liability. In consideration of being permitted to participate in Urban PL activities, I hereby release, discharge, and covenant not to sue Urban PL and the Releasees from all liability, claims, demands, losses, or damages arising out of or caused in whole or in part by my participation, even if caused by the negligence of the Releasees. I accept all responsibility for losses, costs, and damages I incur as a result of my participation.

5.4. Indemnification. I agree to indemnify and hold harmless Urban PL and the Releasees from any loss, liability, damage, or costs — including legal fees — that they may incur due to my participation, whether caused by negligence or otherwise.

5.5. Property. Urban PL is not responsible for personal property that is lost, stolen, or damaged at any game venue.

5.6. Game cancellation. While we make every effort to confirm games, we cannot guarantee any specific game will proceed. We are not liable for costs you incur (e.g. travel) if a game is cancelled.

5.7. Medical emergency consent. In the event of an accident or illness during my participation, I hereby grant authority to Urban PL staff and referees to seek and render reasonable medical assistance or emergency care on my behalf. I accept financial responsibility for any such medical treatment.

5.8. Photo and likeness. I authorize Urban PL to use photographs, images, or video of me taken during activities — including match share cards and promotional materials — without compensation. This does not extend to selling my likeness to third parties.`,
  },
  {
    heading: '6. PRIVACY',
    body: `6.1. Urban PL collects your name, email, phone number, and profile photo to operate the platform, manage game registrations, and keep you informed about your account and upcoming games.

6.2. We do not sell your personal data. We share it only as necessary to deliver our services (e.g. Stripe for payment processing, Supabase for data storage).

6.3. Full details are in our Privacy Policy at theurbanpl.com/privacy-policy.html.`,
  },
  {
    heading: '7. USER RULES',
    body: `7.1. You must comply with the acceptable use and behavioral policies that Urban PL publishes from time to time on the app (collectively the "User Rules"). These rules are not exhaustive, and we reserve the right to modify them and take appropriate disciplinary action — including temporary bans, account suspension, or permanent termination — to protect the integrity of the Urban PL community, regardless of whether a specific behavior is explicitly listed.

The following are examples of behavior that will result in disciplinary action:
  • Impersonating any person, business, or entity, or communicating in a way that falsely implies the message originates from another user.
  • Publicly posting identifying or private information about other players or referees without their consent.
  • Harassing, stalking, threatening, or intimidating other players, referees, or Urban PL staff.
  • Posting or communicating content that is unlawful, harmful, threatening, abusive, harassing, defamatory, vulgar, obscene, sexually explicit, or racially, ethnically, or otherwise objectionable.
  • Choosing an account name or username that is offensive, defamatory, vulgar, or objectionable, or using a misspelling or alternative spelling to circumvent this restriction. Urban PL may modify any name that violates this provision without notice and may take further action for repeated violations.`,
  },
  {
    heading: '8. USER GENERATED CONTENT',
    body: `8.1. You are responsible for all content you upload or send through Urban PL — including your profile photo, username, and in-game chat messages.

8.2. Your profile photo may be visible to other players and referees in games you join. By uploading a photo you confirm you have the right to use it and that it meets our community standards (real photo, no offensive imagery).

8.3. By uploading content to Urban PL you grant us a limited license to display it within the app for the purpose of operating the platform (e.g. showing your photo on game lineups and your profile). We will not use your content for advertising or sell it to third parties.

8.4. Urban PL reserves the right to remove any content that violates these Terms or is otherwise harmful to the community, without prior notice.`,
  },
  {
    heading: '9. CHANGES TO THESE TERMS',
    body: `Urban PL may update these Terms at any time. Continued use of the app after changes are posted means you accept the updated Terms. We will notify you of material changes via email or in-app notice.

For questions about these Terms, contact us at urbanpl.app@gmail.com.`,
  },
];

export default function TermsScreen({ onAccepted }) {
  const { player } = useAuth();
  const [typedName, setTypedName] = useState('');
  const [saving, setSaving] = useState(false);

  const signed = typedName.trim().length > 0;

  function clearSignature() {
    setTypedName('');
  }

  async function handleContinue() {
    if (!signed) {
      Alert.alert('Signature Required', 'Please type your full name to sign the agreement.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('players')
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq('id', player.id);
    setSaving(false);
    if (error) {
      console.error('terms save error:', error);
      Alert.alert('Error', error.message || 'Could not save. Please try again.');
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
          IN CONSIDERATION of being permitted to participate in any Urban PL activity, I agree to the following Terms of Service, Release and Waiver of Liability, and Assumption of Risk. By signing below I certify that I have read and fully understand this agreement and that I sign it freely and voluntarily.
        </Text>

        {T_AND_C.map((section, i) => (
          <View key={i} style={styles.section}>
            {section.heading && <Text style={styles.sectionHeading}>{section.heading}</Text>}
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}

        {/* Signature area */}
        <View style={styles.sigWrap}>
          <Text style={styles.sigLabel}>Type your full name to sign</Text>
          <TextInput
            style={styles.sigInput}
            value={typedName}
            onChangeText={setTypedName}
            placeholder="Full name"
            placeholderTextColor="#bbb"
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="done"
          />
          {typedName.trim().length > 0 && (
            <Text style={styles.sigPreview}>{typedName}</Text>
          )}
          <View style={styles.sigLine} />
          <Text style={styles.sigDisclaimer}>
            By typing your name above, you are signing this agreement electronically. You agree your electronic signature is the legal equivalent of your manual signature on this document.
          </Text>
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

  // Minor guardian box
  minorBox: {
    marginTop: 24,
    backgroundColor: '#fff8e7',
    borderWidth: 1, borderColor: '#e8c84a',
    borderRadius: 8, padding: 14,
  },
  minorTitle: {
    fontSize: 12, fontWeight: '800', color: '#7a5c00', marginBottom: 6,
  },
  minorBody: {
    fontSize: 12, color: '#5a4200', lineHeight: 18,
  },

  // Signature
  sigWrap: { marginTop: 24 },
  sigLabel: {
    fontSize: 13, color: '#3a7bd5', fontWeight: '600', marginBottom: 10,
  },
  sigInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#f9f9f9',
  },
  sigPreview: {
    marginTop: 12,
    fontSize: 26,
    fontStyle: 'italic',
    color: '#111',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  sigLine: {
    height: 1.5, backgroundColor: '#ccc', marginTop: 12,
  },
  sigDisclaimer: {
    marginTop: 8,
    fontSize: 11,
    color: '#888',
    lineHeight: 16,
    textAlign: 'center',
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
