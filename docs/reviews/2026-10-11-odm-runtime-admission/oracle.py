"""Typed native admission gates, without claiming complete worker recovery."""
import copy

EXPECTED = {'originalScratchHasNoAdmissionRegistry':True,'replacementUsesFreshScratch':True,'missingDatabaseStartupRefused':True,'missingSealStartupRefused':True,'negativeFixturesRestored':True,'firstAdmissionStatus':202,'queuedAdmissionStatus':202,'predeathReplayStatus':200,
    'predeathReceiptExact':True,'changedStatus':409,'restartAdmissionStatus':200,'restartReceiptExact':True,
    'originalStartedReceiptExact':True,'firstStartPreserved':True,'queuedAdmissionPreserved':True,
    'restoredHeldStarted':1,'restoredAccepted':1,'sourceGetsBeforeDeath':1,'sourceGetsFinal':1,
    'sourceBodyBytesSent':0,'engineRequests':0,'sqliteCopies':1,'captureExit':0,'verifyExit':0,
    'capturedOrdinaryMatchesSource':True,'capturedJournalMatchesSource':True,
    'sourceOrdinaryUnchanged':True,'sourceJournalUnchanged':True,'packageUnchanged':True,
    'runtimeJournalUnchanged':True,'exactOriginalRequestBytes':True,'sourceBindingsUnchanged':True}


def verify(record):
    for key, expected in EXPECTED.items():
        if key not in record or type(record[key]) is not type(expected) or record[key] != expected:
            raise ValueError('runtime-admission-native-'+key)


def controls(record):
    outcomes=[]
    for label,value in [('baseline',record),('harmless-order',dict(reversed(list(record.items())))),('restored',record)]:
        verify(value);outcomes.append({'control':label,'outcome':'survived'})
    for key,expected in EXPECTED.items():
        for kind in ('wrong','missing','wrong-type'):
            value=copy.deepcopy(record)
            if kind=='missing':value.pop(key)
            elif kind=='wrong-type':value[key]=int(expected) if type(expected) is bool else str(expected)
            else:value[key]=not expected if type(expected) is bool else expected+1
            try:verify(value)
            except ValueError as error:
                if str(error)!='runtime-admission-native-'+key:raise
                outcomes.append({'control':key+'-'+kind,'outcome':'intended_failure','reason':str(error)})
            else:raise AssertionError('Native admission control survived: '+key)
    return outcomes
