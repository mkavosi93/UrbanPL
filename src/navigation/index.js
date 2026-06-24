import React from 'react';
import { View, ActivityIndicator, Platform, TouchableOpacity } from 'react-native';
import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FeedScreen from '../screens/FeedScreen';
import CupsScreen from '../screens/CupsScreen';
import RankingsScreen from '../screens/RankingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RefereeScreen from '../screens/RefereeScreen';
import AdminScreen from '../screens/AdminScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import RefereeLoginScreen from '../screens/auth/RefereeLoginScreen';
import RefereeSignUpScreen from '../screens/auth/RefereeSignUpScreen';
import TermsScreen from '../screens/auth/TermsScreen';

import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICON_MAP = {
  Feed:     ['football',    'football-outline'],
  Cups:     ['trophy',      'trophy-outline'],
  Rankings: ['stats-chart', 'stats-chart-outline'],
  Profile:  ['person',      'person-outline'],
  Referee:  ['flag',        'flag-outline'],
  Admin:    ['settings',    'settings-outline'],
};

function TabIcon({ name, focused, color }) {
  const [active, inactive] = TAB_ICON_MAP[name] || ['ellipse', 'ellipse-outline'];
  return <Ionicons name={focused ? active : inactive} size={22} color={color} />;
}

const TAB_SCREEN_OPTIONS = {
  tabBarActiveTintColor: colors.gold,
  tabBarInactiveTintColor: colors.gray,
  tabBarStyle: {
    backgroundColor: colors.darkCard,
    borderTopColor: colors.darkBorder,
    borderTopWidth: 1,
    height: 64,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  headerStyle: { backgroundColor: colors.dark },
  headerShadowVisible: false,
  headerTitleStyle: {
    color: colors.gold,
    fontWeight: '700',
    fontSize: 18,
    letterSpacing: -0.3,
  },
  headerTintColor: colors.gold,
};

// ─── Pending approval screen (referee not yet approved) ───────────────────────
function PendingApprovalScreen() {
  const { signOut } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: '#07080a', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ fontSize: 56, marginBottom: 20 }}>⏳</Text>
      <Text style={{ color: colors.gold, fontSize: 22, fontWeight: '900', marginBottom: 10, textAlign: 'center' }}>
        Application Under Review
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 40 }}>
        Our team is verifying your ID and selfie.{'\n'}You'll be notified by email once approved.
      </Text>
      <TouchableOpacity
        onPress={signOut}
        style={{ paddingVertical: 10, paddingHorizontal: 28, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}
      >
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Referee-only tabs ────────────────────────────────────────────────────────
function RefereeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        ...TAB_SCREEN_OPTIONS,
      })}
    >
      <Tab.Screen
        name="Referee"
        component={RefereeScreen}
        options={{ tabBarLabel: 'Referee', headerTitle: 'Referee Panel' }}
      />
    </Tab.Navigator>
  );
}

// ─── Player / Admin tabs ──────────────────────────────────────────────────────
function MainTabs() {
  const { t } = useLanguage();
  const { player } = useAuth();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        ...TAB_SCREEN_OPTIONS,
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ headerTitle: 'Urban PL', tabBarLabel: t('nav.feed') }} />
      <Tab.Screen name="Cups" component={CupsScreen} options={{ tabBarLabel: t('nav.cups') }} />
      <Tab.Screen name="Rankings" component={RankingsScreen} options={{ tabBarLabel: t('nav.rankings') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: t('nav.profile') }} />
      {player?.is_admin && (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{ tabBarLabel: 'Admin', headerTitle: 'Admin Panel' }}
        />
      )}
    </Tab.Navigator>
  );
}

// ─── Guest tabs (browse without account) ─────────────────────────────────────
function GuestTabs() {
  const { t } = useLanguage();
  const { setIsGuest } = useAuth();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        ...TAB_SCREEN_OPTIONS,
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ headerTitle: 'Urban PL', tabBarLabel: t('nav.feed') }} />
      <Tab.Screen name="Cups" component={CupsScreen} options={{ tabBarLabel: t('nav.cups') }} />
      <Tab.Screen name="Rankings" component={RankingsScreen} options={{ tabBarLabel: t('nav.rankings') }} />
      <Tab.Screen
        name="Profile"
        options={{ tabBarLabel: 'Sign In' }}
      >
        {() => (
          <View style={{ flex: 1, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>⚽</Text>
            <Text style={{ color: colors.white, fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' }}>
              Sign in to play
            </Text>
            <Text style={{ color: colors.gray, fontSize: 14, textAlign: 'center', marginBottom: 28, lineHeight: 22 }}>
              Create an account to join games, register for tournaments, and track your stats.
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: colors.gold, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 }}
              onPress={() => setIsGuest(false)}
            >
              <Text style={{ color: colors.dark, fontWeight: '700', fontSize: 16 }}>Sign In / Sign Up</Text>
            </TouchableOpacity>
          </View>
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="RefereeLogin" component={RefereeLoginScreen} />
      <Stack.Screen name="RefereeSignUp" component={RefereeSignUpScreen} />
    </Stack.Navigator>
  );
}

export default function Navigation() {
  const { session, loading, isPasswordRecovery, player, setPlayer, isGuest } = useAuth();
  const [splashDone, setSplashDone] = React.useState(false);
  const [onboardingChecked, setOnboardingChecked] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [termsAccepted, setTermsAccepted] = React.useState(false);

  React.useEffect(() => {
    async function check() {
      try {
        const val = Platform.OS === 'web'
          ? localStorage.getItem('hasSeenOnboarding')
          : await SecureStore.getItemAsync('hasSeenOnboarding');
        setShowOnboarding(!val);
      } catch {
        setShowOnboarding(false);
      } finally {
        setOnboardingChecked(true);
      }
    }
    check();
  }, []);

  // Show splash first — auth + onboarding checks run in background
  if (!splashDone) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  if (loading || !onboardingChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  if (showOnboarding) {
    return <OnboardingScreen onDone={() => setShowOnboarding(false)} />;
  }

  const isReferee = player?.role === 'Referee';
  const needsTerms = session && player && !player.terms_accepted_at && !termsAccepted;

  return (
    <NavigationContainer>
      {isPasswordRecovery
        ? <ResetPasswordScreen />
        : session
          ? needsTerms
            ? <TermsScreen onAccepted={() => setTermsAccepted(true)} />
            : isReferee
              ? (player?.referee_approved ? <RefereeTabs /> : <PendingApprovalScreen />)
              : <MainTabs />
          : isGuest
            ? <GuestTabs />
            : <AuthStack />
      }
    </NavigationContainer>
  );
}
