import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../theme';

// ─── Constants ────────────────────────────────────────────────────────────────
const TOTAL_STEPS   = 5;
const CERT_LEVELS   = ['None (Learning)', 'FA Level 1', 'USSF Grade 8', 'USSF Grade 7', 'Pro'];
const EXPERIENCE    = ['0–1 yr', '1–3 yrs', '3–5 yrs', '5+ yrs'];
const FORMATS       = ['5v5', '6v6', '7v7', '8v8', '11v11'];
const DAYS          = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS         = ['AM', 'PM', 'EVE'];
const SLOT_LABELS   = { AM: 'Morning', PM: 'Afternoon', EVE: 'Evening' };
const MONTHS        = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FALLBACK_CODE = 'URBANPL-REF';

async function getRefereeCode() {
  try {
    const { data } = await supabase
      .from('app_config').select('value').eq('key', 'referee_code').single();
    return data?.value || FALLBACK_CODE;
  } catch { return FALLBACK_CODE; }
}

async function uploadImage(uri, storagePath) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const { error } = await supabase.storage
    .from('avatars')
    .upload(storagePath, decode(base64), { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(storagePath);
  return publicUrl;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ProgressBar({ step }) {
  return (
    <View style={styles.progressRow}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <React.Fragment key={i}>
          <View style={[
            styles.progressDot,
            i < step  && styles.progressDotDone,
            i === step - 1 && styles.progressDotActive,
          ]}>
            {i < step - 1 && <Text style={styles.progressCheck}>✓</Text>}
            {i === step - 1 && <Text style={styles.progressNum}>{step}</Text>}
          </View>
          {i < TOTAL_STEPS - 1 && (
            <View style={[styles.progressLine, i < step - 1 && styles.progressLineDone]} />
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

function StepHeader({ step, title, subtitle }) {
  return (
    <View style={styles.stepHeader}>
      <ProgressBar step={step} />
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepSubtitle}>{subtitle}</Text>
    </View>
  );
}

function Chip({ label, selected, onPress, multi }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipActive]}
      onPress={onPress}
    >
      {multi && selected && <Text style={styles.chipCheck}>✓ </Text>}
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AvailabilityGrid({ availability, onChange }) {
  function cycleSlot(key) {
    const cur = availability[key];
    const next = !cur || cur === 'Unavailable' ? 'Available'
      : cur === 'Available' ? 'Maybe'
      : 'Unavailable';
    onChange({ ...availability, [key]: next });
  }

  function slotStyle(val) {
    if (val === 'Available') return styles.avSlotAvail;
    if (val === 'Maybe')     return styles.avSlotMaybe;
    return styles.avSlotEmpty;
  }
  function slotLabel(val) {
    if (val === 'Available') return '✅';
    if (val === 'Maybe')     return '🤔';
    return '';
  }

  return (
    <View style={styles.avGrid}>
      {/* Header */}
      <View style={styles.avRow}>
        <View style={styles.avDayLabel} />
        {SLOTS.map(s => (
          <Text key={s} style={styles.avSlotHeader}>{s}</Text>
        ))}
      </View>
      {DAYS.map(day => (
        <View key={day} style={styles.avRow}>
          <Text style={styles.avDayLabel}>{day}</Text>
          {SLOTS.map(slot => {
            const key = `${day}_${slot}`;
            const val = availability[key];
            return (
              <TouchableOpacity
                key={slot}
                style={[styles.avSlot, slotStyle(val)]}
                onPress={() => cycleSlot(key)}
              >
                <Text style={styles.avSlotEmoji}>{slotLabel(val)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
      {/* Legend */}
      <View style={styles.avLegend}>
        {[['✅', 'Available'], ['🤔', 'Maybe'], ['—', 'Unavailable']].map(([icon, label]) => (
          <View key={label} style={styles.avLegendItem}>
            <Text style={styles.avLegendIcon}>{icon}</Text>
            <Text style={styles.avLegendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RefereeSignUpScreen({ navigation }) {
  const [step, setStep]     = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1 – Identity
  const [firstName, setFirstName]       = useState('');
  const [lastName, setLastName]         = useState('');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPass, setShowPass]         = useState(false);
  const [phone, setPhone]               = useState('');
  const [birthMonth, setBirthMonth]     = useState(null);
  const [birthYear, setBirthYear]       = useState('');

  // Step 2 – Profile Photo
  const [avatarUri, setAvatarUri]       = useState(null);

  // Step 3 – Credentials
  const [certLevel, setCertLevel]       = useState('');
  const [experience, setExperience]     = useState('');
  const [formats, setFormats]           = useState([]);

  // Step 4 – Availability
  const [availability, setAvailability] = useState({});

  // Step 5 – ID + Access Code
  const [idDocUri, setIdDocUri]         = useState(null);
  const [accessCode, setAccessCode]     = useState('');

  // ── Validation ──────────────────────────────────────────────────────────────
  function validateStep1() {
    if (!firstName.trim())  { Alert.alert('Missing', 'First name is required.'); return false; }
    if (!lastName.trim())   { Alert.alert('Missing', 'Last name is required.'); return false; }
    if (!email.trim())      { Alert.alert('Missing', 'Email is required.'); return false; }
    if (!phone.trim())      { Alert.alert('Missing', 'Phone number is required.'); return false; }
    if (!birthMonth)        { Alert.alert('Missing', 'Please select your birth month.'); return false; }
    if (!birthYear.trim() || isNaN(parseInt(birthYear))) {
      Alert.alert('Missing', 'Please enter a valid birth year.'); return false;
    }
    const age = new Date().getFullYear() - parseInt(birthYear);
    if (age < 18) { Alert.alert('Age Requirement', 'You must be 18 or older to register as a referee.'); return false; }
    if (password.length < 6) { Alert.alert('Weak Password', 'Password must be at least 6 characters.'); return false; }
    return true;
  }

  function validateStep2() {
    if (!avatarUri) { Alert.alert('Photo Required', 'A profile photo is required so players and admins can identify you on game day.'); return false; }
    return true;
  }

  function validateStep3() {
    if (!certLevel)        { Alert.alert('Missing', 'Please select your certification level.'); return false; }
    if (!experience)       { Alert.alert('Missing', 'Please select your years of experience.'); return false; }
    if (formats.length === 0) { Alert.alert('Missing', 'Select at least one preferred format.'); return false; }
    return true;
  }

  function validateStep4() {
    const filled = Object.values(availability).filter(v => v && v !== 'Unavailable').length;
    if (filled === 0) { Alert.alert('Availability Required', 'Please mark at least one available time slot so the admin can assign you to games.'); return false; }
    return true;
  }

  function validateStep5() {
    if (!idDocUri)          { Alert.alert('ID Required', "A government-issued ID is required to verify your identity. This is kept secure and only seen by admins."); return false; }
    if (!accessCode.trim()) { Alert.alert('Missing', 'Please enter your referee access code.'); return false; }
    return true;
  }

  function next() {
    const validators = [null, validateStep1, validateStep2, validateStep3, validateStep4, validateStep5];
    if (validators[step]?.()) setStep(s => s + 1);
  }
  function back() {
    if (step === 1) navigation.navigate('RefereeLogin');
    else setStep(s => s - 1);
  }

  // ── Image Pickers ───────────────────────────────────────────────────────────
  async function pickImage(setter) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow access to your photos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, quality: 0.7,
    });
    if (!result.canceled) setter(result.assets[0].uri);
  }

  async function takePhoto(setter) {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true, quality: 0.7,
    });
    if (!result.canceled) setter(result.assets[0].uri);
  }

  function pickOptions(setter) {
    Alert.alert('Upload Photo', 'Choose a source', [
      { text: 'Camera', onPress: () => takePhoto(setter) },
      { text: 'Photo Library', onPress: () => pickImage(setter) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Final Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validateStep5()) return;
    setLoading(true);

    try {
      // 1. Verify access code
      const validCode = await getRefereeCode();
      if (accessCode.trim().toUpperCase() !== validCode.toUpperCase()) {
        Alert.alert('Invalid Code', 'The access code is incorrect. Contact your admin.');
        setLoading(false);
        return;
      }

      // 2. Create auth account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (authError) throw new Error(authError.message);
      const userId = authData.user?.id;
      if (!userId) throw new Error('Could not create account.');

      // 3. Upload profile photo (non-fatal if storage bucket missing)
      let avatarUrl = null;
      if (avatarUri) {
        try { avatarUrl = await uploadImage(avatarUri, `${userId}/avatar.jpg`); }
        catch (e) { console.warn('Avatar upload failed:', e.message); }
      }

      // 4. Upload ID document (non-fatal if storage bucket missing)
      let idDocUrl = null;
      if (idDocUri) {
        try { idDocUrl = await uploadImage(idDocUri, `${userId}/referee-id.jpg`); }
        catch (e) { console.warn('ID doc upload failed:', e.message); }
      }

      // 5. Insert player record
      const { error: playerError } = await supabase.from('players').insert({
        id: userId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        name: `${firstName.trim()} ${lastName.trim()}`,
        email: email.trim(),
        phone: phone.trim(),
        birth_month: birthMonth,
        birth_year: parseInt(birthYear),
        role: 'Referee',
        is_referee: true,
        games_played: 0,
        availability,
        avatar_url: avatarUrl,
        referee_cert: certLevel,
        referee_experience: experience,
        referee_formats: formats,
        referee_id_url: idDocUrl,
      });

      if (playerError) throw new Error(playerError.message);

      setLoading(false);
      Alert.alert(
        '✅ Application Submitted!',
        'Your referee account has been created. The admin will review your ID and activate your account. You can now sign in.',
        [{ text: 'Sign In', onPress: () => navigation.navigate('RefereeLogin') }]
      );

    } catch (err) {
      setLoading(false);
      Alert.alert('Error', err.message);
    }
  }

  // ── Toggle format multi-select ───────────────────────────────────────────────
  function toggleFormat(f) {
    setFormats(prev =>
      prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  STEP RENDERS
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Step 1: Identity ──────────────────────────────────────────────────────────
  if (step === 1) return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity onPress={back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        </View>

        <StepHeader step={1} title="Personal Details" subtitle="Your identity as an official" />

        <View style={styles.twoCol}>
          <View style={styles.twoColField}>
            <Text style={styles.label}>First Name</Text>
            <TextInput style={styles.input} placeholder="Carlos" placeholderTextColor={colors.gray}
              value={firstName} onChangeText={setFirstName} />
          </View>
          <View style={styles.twoColField}>
            <Text style={styles.label}>Last Name</Text>
            <TextInput style={styles.input} placeholder="Mendez" placeholderTextColor={colors.gray}
              value={lastName} onChangeText={setLastName} />
          </View>
        </View>

        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} placeholder="your@email.com" placeholderTextColor={colors.gray}
          value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />

        <Text style={styles.label}>Phone Number</Text>
        <TextInput style={styles.input} placeholder="+1 (555) 000-0000" placeholderTextColor={colors.gray}
          value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        <Text style={styles.label}>Date of Birth</Text>
        <View style={styles.dobRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}
            contentContainerStyle={styles.monthScrollContent}>
            {MONTHS.map((m, i) => (
              <TouchableOpacity key={m}
                style={[styles.monthChip, birthMonth === i + 1 && styles.monthChipActive]}
                onPress={() => setBirthMonth(i + 1)}
              >
                <Text style={[styles.monthChipText, birthMonth === i + 1 && styles.monthChipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput style={[styles.input, styles.yearInput]} placeholder="Year" placeholderTextColor={colors.gray}
            value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" maxLength={4} />
        </View>
        {birthYear && parseInt(birthYear) > 0 && (
          <Text style={[styles.ageHint,
            new Date().getFullYear() - parseInt(birthYear) >= 18 ? styles.ageOk : styles.ageBad
          ]}>
            {new Date().getFullYear() - parseInt(birthYear) >= 18
              ? `✅ Age requirement met`
              : `⚠️ Must be 18+ to referee`}
          </Text>
        )}

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput style={[styles.input, styles.passwordInput]} placeholder="Min. 6 characters"
            placeholderTextColor={colors.gray} value={password} onChangeText={setPassword}
            secureTextEntry={!showPass} />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(!showPass)}>
            <Text style={styles.eyeIcon}>{showPass ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.nextBtn} onPress={next}>
          <Text style={styles.nextBtnText}>Next →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Step 2: Profile Photo ─────────────────────────────────────────────────────
  if (step === 2) return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity onPress={back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        </View>

        <StepHeader step={2} title="Profile Photo" subtitle="Required · Players & admins identify you on game day" />

        <View style={styles.photoSection}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarPreview} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarPlaceholderIcon}>🟨</Text>
              <Text style={styles.avatarPlaceholderText}>No photo yet</Text>
            </View>
          )}

          <View style={styles.photoButtons}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => takePhoto(setAvatarUri)}>
              <Text style={styles.photoBtnIcon}>📷</Text>
              <Text style={styles.photoBtnText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(setAvatarUri)}>
              <Text style={styles.photoBtnIcon}>🖼️</Text>
              <Text style={styles.photoBtnText}>Choose from Library</Text>
            </TouchableOpacity>
          </View>

          {avatarUri && (
            <TouchableOpacity style={styles.retakeBtn} onPress={() => pickOptions(setAvatarUri)}>
              <Text style={styles.retakeBtnText}>Retake / Change Photo</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoBoxText}>
            📋 Use a clear headshot with your face visible. This photo appears on the referee panel and game day roster.
          </Text>
        </View>

        <TouchableOpacity style={styles.nextBtn} onPress={next}>
          <Text style={styles.nextBtnText}>Next →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Step 3: Credentials ───────────────────────────────────────────────────────
  if (step === 3) return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity onPress={back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        </View>

        <StepHeader step={3} title="Your Credentials" subtitle="Certification, experience & preferred formats" />

        <Text style={styles.label}>Certification Level</Text>
        <View style={styles.chipGrid}>
          {CERT_LEVELS.map(c => (
            <Chip key={c} label={c} selected={certLevel === c} onPress={() => setCertLevel(c)} />
          ))}
        </View>

        <Text style={styles.label}>Years of Experience</Text>
        <View style={styles.chipRow}>
          {EXPERIENCE.map(e => (
            <Chip key={e} label={e} selected={experience === e} onPress={() => setExperience(e)} />
          ))}
        </View>

        <Text style={styles.label}>Preferred Formats <Text style={styles.labelHint}>(select all that apply)</Text></Text>
        <View style={styles.chipRow}>
          {FORMATS.map(f => (
            <Chip key={f} label={f} selected={formats.includes(f)} onPress={() => toggleFormat(f)} multi />
          ))}
        </View>

        {certLevel && experience && formats.length > 0 && (
          <View style={styles.credSummary}>
            <Text style={styles.credSummaryTitle}>Your Profile</Text>
            <Text style={styles.credSummaryText}>🏅 {certLevel}</Text>
            <Text style={styles.credSummaryText}>⏱️ {experience} of experience</Text>
            <Text style={styles.credSummaryText}>⚽ {formats.join(', ')}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.nextBtn} onPress={next}>
          <Text style={styles.nextBtnText}>Next →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Step 4: Availability ──────────────────────────────────────────────────────
  if (step === 4) return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity onPress={back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        </View>

        <StepHeader step={4} title="Your Availability" subtitle="When are you free to officiate?" />

        <View style={styles.infoBox}>
          <Text style={styles.infoBoxText}>
            Tap each slot to cycle: ✅ Available → 🤔 Maybe → blank. Admin uses this to assign you to games.
          </Text>
        </View>

        <AvailabilityGrid availability={availability} onChange={setAvailability} />

        <TouchableOpacity style={styles.nextBtn} onPress={next}>
          <Text style={styles.nextBtnText}>Next →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // ── Step 5: ID Document + Access Code ────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity onPress={back}><Text style={styles.backText}>← Back</Text></TouchableOpacity>
        </View>

        <StepHeader step={5} title="Verification" subtitle="ID document + referee access code" />

        {/* ID Document Upload */}
        <Text style={styles.sectionLabel}>🪪 Government-Issued ID</Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoBoxText}>
            Upload a photo of your driver's license, passport, or national ID. This is only visible to admins and used to verify your identity.
          </Text>
        </View>

        {idDocUri ? (
          <View style={styles.idPreviewContainer}>
            <Image source={{ uri: idDocUri }} style={styles.idPreview} resizeMode="contain" />
            <TouchableOpacity style={styles.retakeBtn} onPress={() => pickOptions(setIdDocUri)}>
              <Text style={styles.retakeBtnText}>Replace Document</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.photoButtons}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => takePhoto(setIdDocUri)}>
              <Text style={styles.photoBtnIcon}>📷</Text>
              <Text style={styles.photoBtnText}>Photograph ID</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage(setIdDocUri)}>
              <Text style={styles.photoBtnIcon}>📁</Text>
              <Text style={styles.photoBtnText}>Upload from Files</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Access Code */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>🔑 Referee Access Code</Text>
        <View style={styles.infoBox}>
          <Text style={styles.infoBoxText}>
            Enter the code provided by the Urban PL admin. This confirms you've been approved as an official.
          </Text>
        </View>
        <TextInput
          style={[styles.input, styles.codeInput]}
          placeholder="e.g. URBANPL-REF"
          placeholderTextColor={colors.gray}
          value={accessCode}
          onChangeText={setAccessCode}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        {/* Summary before submit */}
        <View style={styles.submitSummary}>
          <Text style={styles.submitSummaryTitle}>📋 Application Summary</Text>
          <View style={styles.submitRow}>
            <Text style={styles.submitKey}>Name</Text>
            <Text style={styles.submitVal}>{firstName} {lastName}</Text>
          </View>
          <View style={styles.submitRow}>
            <Text style={styles.submitKey}>Email</Text>
            <Text style={styles.submitVal}>{email}</Text>
          </View>
          <View style={styles.submitRow}>
            <Text style={styles.submitKey}>Cert</Text>
            <Text style={styles.submitVal}>{certLevel || '—'}</Text>
          </View>
          <View style={styles.submitRow}>
            <Text style={styles.submitKey}>Experience</Text>
            <Text style={styles.submitVal}>{experience || '—'}</Text>
          </View>
          <View style={styles.submitRow}>
            <Text style={styles.submitKey}>Formats</Text>
            <Text style={styles.submitVal}>{formats.join(', ') || '—'}</Text>
          </View>
          <View style={styles.submitRow}>
            <Text style={styles.submitKey}>Photo</Text>
            <Text style={[styles.submitVal, { color: avatarUri ? colors.success : colors.error }]}>
              {avatarUri ? '✅ Uploaded' : '❌ Missing'}
            </Text>
          </View>
          <View style={styles.submitRow}>
            <Text style={styles.submitKey}>ID Doc</Text>
            <Text style={[styles.submitVal, { color: idDocUri ? colors.success : colors.error }]}>
              {idDocUri ? '✅ Uploaded' : '❌ Missing'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.nextBtn, styles.submitBtn, loading && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={colors.dark} />
            : <Text style={styles.nextBtnText}>Submit Application →</Text>
          }
        </TouchableOpacity>

        <Text style={styles.submitDisclaimer}>
          By submitting, you confirm all information is accurate and you consent to your ID being reviewed by Urban PL admins.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.dark },
  container: {
    flexGrow: 1, backgroundColor: colors.dark,
    padding: spacing.lg, paddingBottom: spacing.xxl,
  },
  topRow: { flexDirection: 'row', marginBottom: spacing.md },
  backText: { color: colors.gold, fontSize: 15 },

  // Progress
  progressRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', marginBottom: spacing.lg,
  },
  progressDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.darkCard,
    borderWidth: 2, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  progressDotActive: { borderColor: colors.gold, backgroundColor: colors.gold },
  progressDotDone: { borderColor: colors.success, backgroundColor: colors.success },
  progressCheck: { color: colors.dark, fontSize: 11, fontWeight: 'bold' },
  progressNum: { color: colors.dark, fontSize: 12, fontWeight: 'bold' },
  progressLine: { flex: 1, height: 2, backgroundColor: colors.darkBorder, marginHorizontal: 3, maxWidth: 28 },
  progressLineDone: { backgroundColor: colors.success },

  // Step header
  stepHeader: { alignItems: 'center', marginBottom: spacing.xl },
  stepTitle: { color: colors.gold, fontSize: 24, fontWeight: 'bold', marginBottom: spacing.xs },
  stepSubtitle: { color: colors.gray, fontSize: 13, textAlign: 'center' },

  // Labels & inputs
  label: { color: colors.grayLight, fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.md },
  labelHint: { color: colors.gray, fontWeight: 'normal', fontSize: 11 },
  sectionLabel: { color: colors.gold, fontWeight: 'bold', fontSize: 15, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.darkCard, borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: radius.md, color: colors.white, padding: spacing.md, fontSize: 15, width: '100%',
  },
  codeInput: {
    fontSize: 18, fontWeight: 'bold', letterSpacing: 3,
    textAlign: 'center', color: colors.gold, borderColor: colors.gold,
  },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  eyeBtn: { position: 'absolute', right: spacing.md, top: spacing.md },
  eyeIcon: { fontSize: 18 },

  // Two col
  twoCol: { flexDirection: 'row', gap: spacing.sm },
  twoColField: { flex: 1 },

  // DOB
  dobRow: { gap: spacing.sm },
  monthScroll: { maxHeight: 44 },
  monthScrollContent: { gap: spacing.xs, paddingBottom: 4 },
  monthChip: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.darkBorder, backgroundColor: colors.darkCard,
  },
  monthChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  monthChipText: { color: colors.gray, fontSize: 13 },
  monthChipTextActive: { color: colors.dark, fontWeight: 'bold' },
  yearInput: { width: '100%', marginTop: spacing.xs },
  ageHint: { fontSize: 12, marginTop: 4 },
  ageOk: { color: colors.success },
  ageBad: { color: colors.error },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.darkBorder, backgroundColor: colors.darkCard,
    flexDirection: 'row', alignItems: 'center',
  },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.gray, fontSize: 13 },
  chipTextActive: { color: colors.dark, fontWeight: 'bold' },
  chipCheck: { color: colors.dark, fontSize: 12, fontWeight: 'bold' },

  // Photo section
  photoSection: { alignItems: 'center', marginVertical: spacing.xl },
  avatarPreview: {
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 3, borderColor: colors.gold,
    marginBottom: spacing.lg,
  },
  avatarPlaceholder: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: colors.darkCard,
    borderWidth: 2, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  avatarPlaceholderIcon: { fontSize: 40, marginBottom: 8 },
  avatarPlaceholderText: { color: colors.gray, fontSize: 12 },
  photoButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  photoBtn: {
    flex: 1, backgroundColor: colors.darkCard,
    borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', borderWidth: 1, borderColor: colors.darkBorder,
  },
  photoBtnIcon: { fontSize: 28, marginBottom: spacing.xs },
  photoBtnText: { color: colors.grayLight, fontSize: 12, textAlign: 'center' },
  retakeBtn: {
    marginTop: spacing.md, paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  retakeBtnText: { color: colors.gold, fontSize: 13 },

  // ID
  idPreviewContainer: { alignItems: 'center', marginVertical: spacing.md },
  idPreview: {
    width: '100%', height: 200,
    borderRadius: radius.md, borderWidth: 2, borderColor: colors.gold,
    backgroundColor: colors.darkCard,
  },

  // Availability
  avGrid: { marginTop: spacing.sm },
  avRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  avDayLabel: { width: 36, color: colors.gray, fontSize: 12 },
  avSlotHeader: { flex: 1, textAlign: 'center', color: colors.gray, fontSize: 11, fontWeight: '600' },
  avSlot: {
    flex: 1, height: 38, borderRadius: radius.sm,
    marginHorizontal: 2, borderWidth: 1, borderColor: colors.darkBorder,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.darkCard,
  },
  avSlotAvail: { backgroundColor: colors.gold, borderColor: colors.gold },
  avSlotMaybe: { backgroundColor: 'rgba(201,168,76,0.25)', borderColor: colors.gold },
  avSlotEmpty: { backgroundColor: colors.darkCard },
  avSlotEmoji: { fontSize: 16 },
  avLegend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.md },
  avLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avLegendIcon: { fontSize: 14 },
  avLegendText: { color: colors.gray, fontSize: 11 },

  // Credential summary
  credSummary: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.gold,
    marginTop: spacing.xl,
  },
  credSummaryTitle: { color: colors.gold, fontWeight: 'bold', fontSize: 13, marginBottom: spacing.sm },
  credSummaryText: { color: colors.grayLight, fontSize: 13, marginBottom: 4 },

  // Submit summary
  submitSummary: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.darkBorder,
    marginTop: spacing.xl,
  },
  submitSummaryTitle: { color: colors.gold, fontWeight: 'bold', fontSize: 13, marginBottom: spacing.sm },
  submitRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.dark,
  },
  submitKey: { color: colors.gray, fontSize: 13 },
  submitVal: { color: colors.white, fontSize: 13, fontWeight: '500' },

  // Info box
  infoBox: {
    backgroundColor: colors.darkCard, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.darkBorder,
    marginBottom: spacing.sm,
  },
  infoBoxText: { color: colors.grayLight, fontSize: 13, lineHeight: 20 },

  // Buttons
  nextBtn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.xl,
  },
  nextBtnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  submitBtn: { marginTop: spacing.lg },
  submitDisclaimer: {
    color: colors.gray, fontSize: 11, textAlign: 'center',
    marginTop: spacing.md, lineHeight: 16,
  },
});
